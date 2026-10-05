import json
import os
import re
import secrets
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from .security import digest_token, hash_password, verify_password, validate_feed, validate_mapping, matches_feed

PLANS = {
    'starter': {'name': 'Starter', 'price': '1.49', 'feeds': 100, 'keywords': 20},
    'pro': {'name': 'Pro', 'price': '4.99', 'feeds': 400, 'keywords': None},
    'selfhost': {'name': 'Self-host', 'price': '0', 'feeds': None, 'keywords': None},
}


class Store:
    def __init__(self, path):
        original = Path(path).absolute()
        if original.is_symlink():
            raise ValueError('データベースにシンボリックリンクは使用できません。')
        self.path = original.resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if self.path.is_symlink():
            raise ValueError('データベースにシンボリックリンクは使用できません。')
        with self.connection() as db:
            db.executescript('''
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS users (
              id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
              plan TEXT NOT NULL, source_hash TEXT UNIQUE NOT NULL, mapping TEXT NOT NULL DEFAULT '{}');
            CREATE TABLE IF NOT EXISTS sessions (
              token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS feeds (
              id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), config TEXT NOT NULL,
              enabled INTEGER NOT NULL DEFAULT 1);
            CREATE TABLE IF NOT EXISTS events (
              id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), post_id TEXT NOT NULL,
              post TEXT NOT NULL, received REAL NOT NULL, UNIQUE(user_id, post_id));
            CREATE TABLE IF NOT EXISTS jobs (
              id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), feed_id TEXT NOT NULL REFERENCES feeds(id),
              event_id TEXT NOT NULL REFERENCES events(id), state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
              next_at REAL NOT NULL, lease TEXT, lease_until REAL, error TEXT NOT NULL DEFAULT '', completed REAL,
              UNIQUE(feed_id,event_id));
            CREATE INDEX IF NOT EXISTS jobs_due ON jobs(state,next_at);
            CREATE INDEX IF NOT EXISTS jobs_workspace ON jobs(user_id);
            CREATE TABLE IF NOT EXISTS push_inbox (
              id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
              payload TEXT NOT NULL, received REAL NOT NULL);
            CREATE INDEX IF NOT EXISTS push_inbox_owner ON push_inbox(user_id,received);
            ''')
            if 'enabled' not in {row['name'] for row in db.execute('PRAGMA table_info(feeds)')}:
                db.execute('ALTER TABLE feeds ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1')
                for row in db.execute('SELECT id,config FROM feeds').fetchall():
                    db.execute('UPDATE feeds SET enabled=? WHERE id=?', (int(json.loads(row['config'])['enabled']), row['id']))
        os.chmod(self.path, 0o600)

    @contextmanager
    def connection(self):
        db = sqlite3.connect(str(self.path), timeout=10)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        try:
            with db:
                yield db
        finally:
            db.close()

    @staticmethod
    def public_user(row):
        return {'id': row['id'], 'email': row['email'], 'plan': row['plan'], 'mapping': json.loads(row['mapping'])}

    def create_user(self, email, password, plan='selfhost'):
        if not isinstance(email, str) or len(email) > 254 or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email):
            raise ValueError('メールアドレスを確認してください。')
        if plan not in PLANS:
            raise ValueError('プランが不正です。')
        password_hash = hash_password(password)
        user_id, source = secrets.token_hex(16), secrets.token_urlsafe(32)
        try:
            with self.connection() as db:
                db.execute('INSERT INTO users(id,email,password_hash,plan,source_hash) VALUES(?,?,?,?,?)',
                           (user_id, email.strip().lower(), password_hash, plan, digest_token(source)))
        except sqlite3.IntegrityError:
            raise ValueError('このメールアドレスでは登録できません。')
        return dict(self.get_user(user_id), source_token=source)

    def get_user(self, user_id):
        with self.connection() as db:
            row = db.execute('SELECT * FROM users WHERE id=?', (user_id,)).fetchone()
        if not row:
            raise KeyError('アカウントが見つかりません。')
        return self.public_user(row)

    def authenticate(self, email, password):
        with self.connection() as db:
            row = db.execute('SELECT * FROM users WHERE email=?', (str(email).lower().strip(),)).fetchone()
        # Use the same expensive primitive for a missing account, to reduce enumeration by timing.
        encoded = row['password_hash'] if row else 'pbkdf2_sha256$600000$' + '00' * 16 + '$' + '00' * 32
        valid = verify_password(password, encoded)
        return self.public_user(row) if row and valid else None

    def session(self, user_id, now=None):
        now = time.time() if now is None else now
        token = secrets.token_urlsafe(32)
        with self.connection() as db:
            db.execute('DELETE FROM sessions WHERE expires<?', (now,))
            db.execute('INSERT INTO sessions VALUES(?,?,?)', (digest_token(token), user_id, now + 86400))
        return token

    def user_for_session(self, token, now=None):
        now = time.time() if now is None else now
        with self.connection() as db:
            row = db.execute('SELECT users.* FROM users JOIN sessions ON users.id=sessions.user_id WHERE token_hash=? AND expires>?',
                             (digest_token(token), now)).fetchone()
        return self.public_user(row) if row else None

    def revoke_session(self, token):
        with self.connection() as db:
            db.execute('DELETE FROM sessions WHERE token_hash=?', (digest_token(token),))

    def user_for_source(self, token):
        with self.connection() as db:
            row = db.execute('SELECT * FROM users WHERE source_hash=?', (digest_token(token),)).fetchone()
        return self.public_user(row) if row else None

    def rotate_source(self, user_id):
        token = secrets.token_urlsafe(32)
        with self.connection() as db:
            db.execute('UPDATE users SET source_hash=? WHERE id=?', (digest_token(token), user_id))
        return token

    def set_mapping(self, user_id, mapping):
        if mapping:
            validate_mapping(mapping)
        elif not isinstance(mapping, dict):
            raise ValueError('連携設定の通知データの項目名を確認してください。')
        with self.connection() as db:
            db.execute('UPDATE users SET mapping=? WHERE id=?', (json.dumps(mapping), user_id))

    def purge_push_inbox(self, now=None):
        now = time.time() if now is None else now
        with self.connection() as db:
            db.execute('DELETE FROM push_inbox WHERE received<=?', (now - 86400,))

    def capture_push(self, user_id, payload, now=None):
        now = time.time() if now is None else now
        encoded = json.dumps(payload, ensure_ascii=False)
        if not isinstance(payload, dict) or len(encoded.encode()) > 65536:
            raise ValueError('通知は64KB以内のJSONオブジェクトで送信してください。')
        with self.connection() as db:
            db.execute('DELETE FROM push_inbox WHERE received<=?', (now - 86400,))
            db.execute('INSERT INTO push_inbox VALUES(?,?,?,?)',
                       (secrets.token_hex(16), user_id, encoded, now))
            db.execute('DELETE FROM push_inbox WHERE user_id=? AND id NOT IN '
                       '(SELECT id FROM push_inbox WHERE user_id=? ORDER BY received DESC,rowid DESC LIMIT 20)',
                       (user_id, user_id))

    def set_plan(self, user_id, plan):
        if plan not in PLANS:
            raise ValueError('プランが不正です。')
        limits = PLANS[plan]
        feeds = self.list_feeds(user_id)
        if limits['feeds'] is not None and len(feeds) > limits['feeds']:
            raise ValueError(f'通知設定が{len(feeds)}件あるため、このプランの上限{limits["feeds"]}件を超えています。別のプランを選んでください。')
        for feed in feeds:
            if limits['keywords'] is not None and len(feed['include']) + len(feed['exclude']) > limits['keywords']:
                raise ValueError(f'@{feed["handle"]}のキーワードが{len(feed["include"]) + len(feed["exclude"])}個あるため、このプランの上限{limits["keywords"]}個を超えています。キーワードを減らすか、別のプランを選んでください。')
        with self.connection() as db:
            db.execute('UPDATE users SET plan=? WHERE id=?', (plan, user_id))

    @staticmethod
    def public_feed(row):
        config = json.loads(row['config'])
        config['webhook_configured'] = bool(config.pop('webhook_url', ''))
        return dict(id=row['id'], **config)

    def list_feeds(self, user_id):
        with self.connection() as db:
            rows = db.execute('SELECT * FROM feeds WHERE user_id=? ORDER BY rowid', (user_id,)).fetchall()
        return [self.public_feed(row) for row in rows]

    def create_feed(self, user_id, data):
        with self.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            user = db.execute('SELECT plan FROM users WHERE id=?', (user_id,)).fetchone()
            if not user:
                raise KeyError('アカウントが見つかりません。')
            limits = PLANS[user['plan']]
            config = validate_feed(data, limits['keywords'])
            count = db.execute('SELECT COUNT(*) FROM feeds WHERE user_id=?', (user_id,)).fetchone()[0]
            if limits['feeds'] is not None and count >= limits['feeds']:
                raise ValueError(f'このプランで追加できる通知設定は{limits["feeds"]}件までです（現在{count}件）。')
            if count >= 2000:
                raise ValueError(f'通知設定は最大2000件まで追加できます（現在{count}件）。')
            feed_id = secrets.token_hex(12)
            db.execute('INSERT INTO feeds(id,user_id,config,enabled) VALUES(?,?,?,?)', (feed_id, user_id, json.dumps(config), int(config['enabled'])))
            return self.public_feed({'id': feed_id, 'config': json.dumps(config)})

    def update_feed(self, user_id, feed_id, changes):
        allowed = {'handle', 'channel', 'include', 'exclude', 'webhook_url', 'role_id',
                   'include_replies', 'include_reposts', 'enabled'}
        if not isinstance(changes, dict) or set(changes) - allowed:
            raise ValueError('通知設定の入力内容を確認してください。')
        with self.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT * FROM feeds WHERE id=? AND user_id=?', (feed_id, user_id)).fetchone()
            if not row:
                raise KeyError('この通知設定が見つかりません。通知一覧から選び直してください。')
            config = json.loads(row['config'])
            config.update(changes)
            plan = db.execute('SELECT plan FROM users WHERE id=?', (user_id,)).fetchone()[0]
            config = validate_feed(config, PLANS[plan]['keywords'])
            db.execute('UPDATE feeds SET config=?,enabled=? WHERE id=? AND user_id=?', (json.dumps(config), int(config['enabled']), feed_id, user_id))
            return self.public_feed({'id': feed_id, 'config': json.dumps(config)})

    def ingest(self, user_id, post, now=None):
        now = time.time() if now is None else now
        with self.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            existing = db.execute('SELECT id FROM events WHERE user_id=? AND post_id=?', (user_id, post['id'])).fetchone()
            if existing:
                return {'queued': 0, 'duplicate': True}
            event_id = secrets.token_hex(12)
            db.execute('INSERT INTO events VALUES(?,?,?,?,?)', (event_id, user_id, post['id'], json.dumps(post), now))
            queued = 0
            for feed in db.execute('SELECT * FROM feeds WHERE user_id=?', (user_id,)).fetchall():
                config = json.loads(feed['config'])
                if matches_feed(post, config):
                    db.execute('INSERT INTO jobs(id,user_id,feed_id,event_id,state,next_at) VALUES(?,?,?,?,?,?)',
                               (secrets.token_hex(12), user_id, feed['id'], event_id, 'queued', now))
                    queued += 1
            return {'queued': queued, 'duplicate': False}

    def claim_job(self, now=None, lease_seconds=30):
        now = time.time() if now is None else now
        with self.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            rows = db.execute('''SELECT jobs.*, feeds.config, events.post FROM jobs
              JOIN feeds ON feeds.id=jobs.feed_id JOIN events ON events.id=jobs.event_id
              WHERE feeds.enabled=1 AND ((state IN ('queued','retry') AND next_at<=?) OR (state='sending' AND lease_until<=?))
              ORDER BY next_at LIMIT 1''', (now, now)).fetchall()
            for row in rows:
                config = json.loads(row['config'])
                if not config['enabled']:
                    continue
                lease = secrets.token_hex(12)
                db.execute('UPDATE jobs SET state=?,attempts=attempts+1,lease=?,lease_until=? WHERE id=?',
                           ('sending', lease, now + lease_seconds, row['id']))
                return dict(id=row['id'], attempts=row['attempts'] + 1, lease=lease,
                            feed_id=row['feed_id'], user_id=row['user_id'], post=json.loads(row['post']), **config)
        return None

    def finish_job(self, job_id, lease, state, error='', delay=0, now=None):
        if state not in {'retry', 'failed', 'simulated', 'delivered'}:
            raise ValueError('送信状態を確認してください。')
        now = time.time() if now is None else now
        with self.connection() as db:
            cursor = db.execute('''UPDATE jobs SET state=?,error=?,next_at=?,lease=NULL,lease_until=NULL,completed=?
               WHERE id=? AND lease=? AND state='sending' ''',
               (state, error[:200], now + delay, None if state == 'retry' else now, job_id, lease))
            return cursor.rowcount == 1

    def list_jobs(self, user_id, limit=100):
        with self.connection() as db:
            rows = db.execute('''SELECT jobs.*, events.post, events.received, feeds.config FROM jobs
              JOIN events ON events.id=jobs.event_id JOIN feeds ON feeds.id=jobs.feed_id
              WHERE jobs.user_id=? ORDER BY events.received DESC,jobs.rowid DESC LIMIT ?''',
                              (user_id, limit)).fetchall()
        return [dict(id=row['id'], feed_id=row['feed_id'], state=row['state'], attempts=row['attempts'], next_at=row['next_at'],
                     received=row['received'], completed=row['completed'], error=row['error'],
                     channel=json.loads(row['config'])['channel'], post=json.loads(row['post'])) for row in rows]

    def retry_job(self, user_id, job_id, now=None):
        now = time.time() if now is None else now
        with self.connection() as db:
            row = db.execute('SELECT state FROM jobs WHERE id=? AND user_id=?', (job_id, user_id)).fetchone()
            if not row:
                raise KeyError('この送信履歴が見つかりません。送信履歴を開き直してください。')
            if row['state'] != 'failed':
                raise ValueError('もう一度送信できるのは、送信に失敗した通知だけです。')
            db.execute('UPDATE jobs SET state=?,attempts=0,next_at=?,error=?,completed=NULL WHERE id=? AND user_id=?',
                       ('queued', now, '', job_id, user_id))

    def stats(self, user_id):
        with self.connection() as db:
            rows = db.execute('SELECT state,COUNT(*) AS count FROM jobs WHERE user_id=? GROUP BY state', (user_id,)).fetchall()
            total = db.execute('SELECT COUNT(*) FROM events WHERE user_id=?', (user_id,)).fetchone()[0]
        return dict(events=total, **{row['state']: row['count'] for row in rows})
