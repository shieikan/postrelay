import hmac
import json
import os
import secrets
import threading
import time
from collections import defaultdict, deque
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
from .store import LIMITS
from .security import normalize_notification
from .engine import Worker
from .webpush import normalize_web_push, PushUnavailable

WEB_ROOT = Path(__file__).resolve().parent.parent / 'web'
MAX_BODY = 65536


class App:
    def __init__(self, store, mode='demo', live=False, public_url='', signup_key=''):
        self.store, self.mode, self.live = store, mode, live
        self.public_url, self.signup_key = public_url.rstrip('/'), signup_key
        self.stop = threading.Event()
        self.rate_lock = threading.Lock()
        self.rates = defaultdict(deque)
        self.demo_user = None
        if mode == 'demo':
            self.seed_demo()

    def seed_demo(self):
        with self.store.connection() as db:
            row = db.execute('SELECT id FROM users WHERE email=?', ('demo@example.test',)).fetchone()
        if row:
            self.demo_user = row['id']
            return
        user = self.store.create_user('demo@example.test', secrets.token_urlsafe(32))
        self.demo_user = user['id']
        samples = [
            ('demo_studio', 'product-news', ['リリース', '公開'], []),
            ('demo_events', 'community', ['募集', '開催'], ['広告']),
            ('demo_releases', 'dev-updates', [], []),
        ]
        for handle, channel, include, exclude in samples:
            self.store.create_feed(user['id'], dict(handle=handle, channel=channel, include=include, exclude=exclude))
        texts = [('demo_studio', '新しい共同編集機能を公開しました。デモで使い方をご覧いただけます。'),
                 ('demo_events', 'オンライン勉強会を開催します。参加者の募集を開始しました。'),
                 ('demo_releases', 'v2.4をリリースしました。読み込み速度とキーボード操作を改善しています。'),
                 ('demo_studio', '本日の開発メモ。小さな改善を積み重ねています。'),
                 ('demo_events', 'コミュニティ交流会を開催します。詳細は投稿リンクから。')]
        for index, (author, text) in enumerate(texts):
            post_id = str(10001 + index)
            self.store.ingest(user['id'], normalize_notification(dict(id=post_id, author=author, text=text,
                              url=f'https://x.com/{author}/status/{post_id}')), now=time.time() - 3600 + index * 420)
        worker = Worker(self.store, mode='demo')
        for _ in texts:
            worker.tick()

    def limited(self, key, count, window=60):
        now = time.monotonic()
        with self.rate_lock:
            queue = self.rates[key]
            while queue and queue[0] < now - window:
                queue.popleft()
            if len(queue) >= count:
                return True
            queue.append(now)
            # A local instance does not retain an unbounded map of failed source tokens/IPs.
            if len(self.rates) > 10000:
                self.rates = defaultdict(deque, {key: queue})
        return False


def make_server(store, host='127.0.0.1', port=8765, mode='demo', live=False, public_url='', signup_key='', capture_push=False, relay_web_push=False):
    if mode not in {'demo', 'selfhost'} or (mode == 'demo' and live):
        raise ValueError('デモではDiscordへ送信できません。')
    if (capture_push or relay_web_push) and (mode != 'selfhost' or host != '127.0.0.1'
                         or (public_url and urlsplit(public_url).hostname not in {'127.0.0.1', 'localhost'})):
        raise ValueError('X通知の受信は、セルフホストのループバック接続だけで利用できます。')
    app = App(store, mode, live, public_url, signup_key)

    class Handler(BaseHTTPRequestHandler):
        server_version = 'PostRelay'

        def log_message(self, format, *args):
            # Request paths can include the ingest secret. Never log them, request bodies or cookies.
            pass

        def headers_common(self):
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.send_header('X-Frame-Options', 'DENY')
            self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")

        def json(self, status, data, cookie=None):
            body = json.dumps(data, ensure_ascii=False).encode()
            self.send_response(status)
            self.headers_common()
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            if cookie:
                self.send_header('Set-Cookie', cookie)
            self.end_headers()
            self.wfile.write(body)

        def host_valid(self):
            expected = urlsplit(app.public_url).netloc
            return self.headers.get('Host') == expected

        def mutation_valid(self):
            origin = self.headers.get('Origin')
            return (self.host_valid() and self.headers.get('X-PostRelay') == '1'
                    and (origin is None or origin == app.public_url)
                    and self.headers.get('Sec-Fetch-Site') not in {'cross-site'})

        def body(self):
            if self.headers.get('Content-Type', '').split(';')[0].strip() != 'application/json':
                raise ValueError('Content-Typeをapplication/jsonにしてください。')
            try:
                length = int(self.headers.get('Content-Length', '0'))
            except ValueError:
                raise ValueError('リクエストサイズが不正です。')
            if not 0 < length <= MAX_BODY:
                raise ValueError('リクエストは64KB以内にしてください。')
            try:
                data = json.loads(self.rfile.read(length))
            except (ValueError, UnicodeError):
                raise ValueError('JSONの形式を確認してください。')
            if not isinstance(data, dict):
                raise ValueError('JSONオブジェクトを送信してください。')
            return data

        def session_token(self):
            try:
                cookies = SimpleCookie()
                cookies.load(self.headers.get('Cookie', ''))
                return cookies['postrelay_session'].value if 'postrelay_session' in cookies else ''
            except Exception:
                return ''

        def user(self):
            token = self.session_token()
            return app.store.user_for_session(token) if token else None

        def session_cookie(self, token='', expire=False):
            secure = '; Secure' if app.public_url.startswith('https://') else ''
            return f'postrelay_session={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={0 if expire else 86400}{secure}'

        def do_GET(self):
            if not self.host_valid():
                return self.json(403, {'error': 'アクセス元を確認してください。'})
            path = urlsplit(self.path).path
            if path == '/api/bootstrap':
                return self.json(200, dict(mode=app.mode, live=app.live, limits=LIMITS, user=self.user()))
            if path == '/api/state':
                user = self.user()
                if not user:
                    return self.json(401, {'error': 'ログインしてください。'})
                return self.json(200, dict(user=user, feeds=app.store.list_feeds(user['id']),
                     jobs=app.store.list_jobs(user['id']), stats=app.store.stats(user['id']),
                     mode=app.mode, live=app.live, limits=LIMITS))
            static = {'/': ('index.html', 'text/html'), '/app.js': ('app.js', 'text/javascript'),
                      '/style.css': ('style.css', 'text/css'), '/favicon.svg': ('favicon.svg', 'image/svg+xml')}
            if path not in static:
                return self.json(404, {'error': 'ページが見つかりません。'})
            name, mime = static[path]
            body = (WEB_ROOT / name).read_bytes()
            self.send_response(200)
            self.headers_common()
            self.send_header('Content-Type', mime + '; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            self.close_connection = True
            path = urlsplit(self.path).path
            try:
                if not self.host_valid():
                    return self.json(403, {'error': 'アクセス元を確認してください。'})
                if path.startswith('/api/push/'):
                    if not (capture_push or relay_web_push):
                        return self.json(404, {'error': '通知の形式確認は有効になっていません。'})
                    user = app.store.user_for_source(path[len('/api/push/'):])
                    if not user:
                        return self.json(401, {'error': 'PostRelayの受け取りURLを確認してください。'})
                    if app.limited(('push-capture', user['id']), 60):
                        return self.json(429, {'error': '通知の受け取りが多すぎます。少し待って、もう一度送信してください。'})
                    payload = self.body()
                    if relay_web_push:
                        feeds = app.store.list_feeds(user['id'])
                        authors = {feed['handle'] for feed in feeds if feed['enabled']}
                        try:
                            post = normalize_web_push(payload, authors)
                        except PushUnavailable:
                            pass
                        else:
                            result = app.store.ingest(user['id'], post)
                            return self.json(202, dict(result, verified_public_post=True))
                    if capture_push:
                        app.store.capture_push(user['id'], payload)
                        return self.json(202, {'captured': True, 'forwarded': False})
                    return self.json(422, {'error': '公開投稿を確認できないため送信しませんでした。'})
                if path.startswith('/api/hooks/'):
                    user = app.store.user_for_source(path[len('/api/hooks/'):])
                    if not user:
                        return self.json(401, {'error': 'PostRelayの受け取りURLを確認してください。'})
                    if app.limited(('ingest', user['id']), 600):
                        return self.json(429, {'error': '投稿通知の受け取り回数が一時的な制限に達しました。少し待って、もう一度送信してください。'})
                    post = normalize_notification(self.body(), user['mapping'])
                    # Return success only after SQLite commits both the notification and its queue jobs.
                    return self.json(202, app.store.ingest(user['id'], post))
                if not self.mutation_valid():
                    return self.json(403, {'error': 'この操作は管理画面から実行してください。'})
                data = self.body()
                if path in {'/api/login', '/api/register', '/api/demo'}:
                    if app.limited(('auth', self.client_address[0]), 10):
                        return self.json(429, {'error': '時間を置いてもう一度お試しください。'})
                    if path == '/api/demo':
                        if app.mode != 'demo':
                            return self.json(404, {'error': 'この環境ではデモを利用できません。'})
                        user = app.store.get_user(app.demo_user)
                    elif path == '/api/register':
                        if app.mode == 'demo':
                            raise ValueError('デモでは「デモを試す」を選んでください。')
                        if app.signup_key and not hmac.compare_digest(str(data.get('signup_key', '')), app.signup_key):
                            return self.json(403, {'error': '登録キーを確認してください。'})
                        created = app.store.create_user(data.get('email'), data.get('password'))
                        user = app.store.get_user(created['id'])
                    else:
                        user = app.store.authenticate(data.get('email'), data.get('password'))
                        if not user:
                            return self.json(401, {'error': 'メールアドレスまたはパスワードを確認してください。'})
                    token = app.store.session(user['id'])
                    return self.json(200, {'user': user}, self.session_cookie(token))
                user = self.user()
                if not user:
                    return self.json(401, {'error': 'ログインしてください。'})
                user_id = user['id']
                if path == '/api/logout':
                    app.store.revoke_session(self.session_token())
                    return self.json(200, {'ok': True}, self.session_cookie(expire=True))
                if path == '/api/feeds':
                    if app.mode == 'demo' and data.get('webhook_url'):
                        raise ValueError('デモではDiscordの送信先URLを保存できません。')
                    return self.json(201, app.store.create_feed(user_id, data))
                if path.startswith('/api/feeds/'):
                    if app.mode == 'demo' and data.get('webhook_url'):
                        raise ValueError('デモではDiscordの送信先URLを保存できません。')
                    return self.json(200, app.store.update_feed(user_id, path[len('/api/feeds/'):], data))
                if path == '/api/source/rotate':
                    token = app.store.rotate_source(user_id)
                    return self.json(200, {'url': app.public_url + '/api/hooks/' + token})
                if path == '/api/source/mapping':
                    app.store.set_mapping(user_id, data.get('mapping'))
                    return self.json(200, {'ok': True})
                if path.startswith('/api/jobs/') and path.endswith('/retry'):
                    job_id = path[len('/api/jobs/'):-len('/retry')]
                    app.store.retry_job(user_id, job_id)
                    return self.json(200, {'ok': True})
                if path == '/api/demo/notification':
                    if app.mode != 'demo':
                        return self.json(403, {'error': 'サンプル通知はデモ専用です。'})
                    handle = data.get('handle', 'demo_studio')
                    post_id = str(time.time_ns())
                    post = normalize_notification(dict(id=post_id, author=handle,
                       text=data.get('text', '新しい機能を公開しました。先行利用者の募集を開始します。'),
                       url=f'https://x.com/{handle}/status/{post_id}'))
                    return self.json(202, app.store.ingest(user_id, post))
                return self.json(404, {'error': '操作が見つかりません。'})
            except ValueError as error:
                return self.json(400, {'error': str(error)})
            except KeyError:
                return self.json(404, {'error': '対象が見つかりません。画面を開き直してください。'})
            except Exception:
                return self.json(500, {'error': '処理を完了できませんでした。時間を置いて再試行してください。'})

    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    if not app.public_url:
        hostname = '127.0.0.1' if host == '0.0.0.0' else host
        app.public_url = f'http://{hostname}:{server.server_address[1]}'
    server.app = app
    server.worker = Worker(store, mode='live' if live else 'demo')
    return server
