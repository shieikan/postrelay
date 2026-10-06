import hashlib
import hmac
import ipaddress
import re
import secrets
from urllib.parse import urlsplit

HANDLE = re.compile(r'^[A-Za-z0-9_]{1,15}$')
POST_ID = re.compile(r'^[0-9]{1,19}$')
DISCORD_HOSTS = {'discord.com', 'ptb.discord.com', 'canary.discord.com'}
REQUIRED_FIELDS = ('id', 'author', 'text', 'url')


def normalize_origin(value):
    message = 'ブラウザーのURLには、認証情報やパスを含まないURLを指定してください。外部ホストにはHTTPSが必要です。'
    if not isinstance(value, str) or not value or len(value) > 2048 or '$' in value or any(ch.isspace() or ord(ch) < 32 for ch in value):
        raise ValueError(message)
    try:
        parsed = urlsplit(value)
        if (parsed.scheme not in {'http', 'https'} or not parsed.hostname or parsed.path not in {'', '/'}
                or parsed.query or parsed.fragment or parsed.username is not None or parsed.password is not None):
            raise ValueError(message)
        port = parsed.port
        if port is not None and not 1 <= port <= 65535:
            raise ValueError(message)
        host = parsed.hostname.encode('idna').decode('ascii').lower()
        try:
            address = ipaddress.ip_address(host)
        except ValueError:
            address = None
            if len(host) > 253 or not all(re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', label) for label in host.split('.')):
                raise ValueError(message)
        if parsed.scheme == 'http' and not (host == 'localhost' or address and address.is_loopback):
            raise ValueError(message)
        if ':' in host:
            host = '[' + host + ']'
        suffix = '' if port is None or port == (80 if parsed.scheme == 'http' else 443) else ':' + str(port)
        return parsed.scheme + '://' + host + suffix
    except (ValueError, UnicodeError):
        raise ValueError(message) from None


def digest_token(value):
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def hash_password(password):
    if not isinstance(password, str) or not 12 <= len(password) <= 1024:
        raise ValueError('パスワードは12〜1024文字で入力してください。')
    salt = secrets.token_hex(16)
    value = hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), 600000).hex()
    return f'pbkdf2_sha256$600000${salt}${value}'


def verify_password(password, encoded):
    if not isinstance(password, str) or len(password) > 1024:
        return False
    try:
        method, rounds, salt, expected = encoded.split('$')
        if method != 'pbkdf2_sha256' or int(rounds) != 600000:
            return False
        actual = hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), int(rounds)).hex()
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def validate_webhook(value):
    if not isinstance(value, str) or len(value) > 500:
        raise ValueError('Discordの送信先URL（Webhook）を確認してください。')
    try:
        parsed = urlsplit(value)
        valid = (parsed.scheme == 'https' and parsed.hostname in DISCORD_HOSTS
                 and parsed.netloc == parsed.hostname and not parsed.username and not parsed.password
                 and parsed.port is None and not parsed.query and not parsed.fragment
                 and re.fullmatch(r'/api/webhooks/[0-9]{1,24}/[A-Za-z0-9_-]{1,200}', parsed.path))
    except ValueError:
        valid = False
    if not valid:
        raise ValueError('Discordの送信先URLには、discord.comのHTTPS Webhook URLを入力してください。')
    return value


def validate_mapping(mapping):
    if not isinstance(mapping, dict) or set(mapping) - set(REQUIRED_FIELDS + ('kind', 'visibility')):
        raise ValueError('連携設定の通知データの項目名を確認してください。')
    for field in REQUIRED_FIELDS:
        if not isinstance(mapping.get(field), str) or not re.fullmatch(r'[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+){0,7}', mapping[field]):
            raise ValueError('通知データのid・author・text・urlに対応する項目名を指定してください。')
    for field in ('kind', 'visibility'):
        if field in mapping and (not isinstance(mapping[field], str) or not re.fullmatch(r'[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+){0,7}', mapping[field])):
            raise ValueError('通知データの項目名を確認してください。入れ子の項目はnotification.bodyのように指定します。')
    return mapping


def normalize_notification(payload, mapping=None):
    if not isinstance(payload, dict):
        raise ValueError('通知はJSONオブジェクトで送信してください。')
    if mapping:
        validate_mapping(mapping)
        data = {}
        for name, path in mapping.items():
            current = payload
            for key in path.split('.'):
                if not isinstance(current, dict) or key not in current:
                    raise ValueError(f'通知データに必要な項目がありません: {name}。連携設定の項目名を確認してください。')
                current = current[key]
            data[name] = current
    else:
        data = payload
    for name in REQUIRED_FIELDS:
        if not isinstance(data.get(name), str):
            raise ValueError(f'通知データの{name}は文字列で指定してください。')
    author = data['author'].lstrip('@').lower()
    if not HANDLE.fullmatch(author) or not POST_ID.fullmatch(data['id']):
        raise ValueError('投稿IDまたはXのユーザー名を確認してください。')
    if not 1 <= len(data['text']) <= 4000:
        raise ValueError('通知本文は1〜4000文字にしてください。')
    try:
        parsed = urlsplit(data['url'])
    except ValueError:
        raise ValueError('公開投稿のURLを確認してください。') from None
    expected_path = f'/{author}/status/{data["id"]}'
    if (parsed.scheme != 'https' or parsed.netloc not in {'x.com', 'twitter.com'}
            or parsed.path.lower() != expected_path or parsed.query or parsed.fragment):
        raise ValueError('公開投稿のURLと、投稿ID・Xのユーザー名が一致しません。通知データを確認してください。')
    kind = data.get('kind', 'post')
    if kind not in {'post', 'reply', 'repost'} or data.get('visibility', 'public') != 'public':
        raise ValueError('公開投稿・返信・リポストの通知だけを扱えます。')
    return {'id': data['id'], 'author': author, 'text': data['text'],
            'url': f'https://x.com/{author}/status/{data["id"]}', 'kind': kind, 'visibility': 'public'}


def validate_feed(data, keyword_limit=None):
    if not isinstance(data, dict):
        raise ValueError('通知設定の入力内容を確認してください。')
    handle = str(data.get('handle', '')).lstrip('@').lower()
    if not HANDLE.fullmatch(handle):
        raise ValueError('Xのユーザー名には英数字とアンダースコア（_）を使ってください。')
    channel = data.get('channel', '')
    if not isinstance(channel, str) or not 1 <= len(channel.strip()) <= 80:
        raise ValueError('チャンネル名は1〜80文字で入力してください。')
    keywords = {}
    for name in ('include', 'exclude'):
        words = data.get(name, [])
        if not isinstance(words, list) or len(words) > 100 or any(not isinstance(v, str) or not 1 <= len(v.strip()) <= 100 for v in words):
            raise ValueError('キーワードは1〜100文字で入力してください。2つの欄を合わせて100個まで設定できます。')
        keywords[name] = list(dict.fromkeys(v.strip() for v in words))
    total_keywords = sum(len(v) for v in keywords.values())
    if total_keywords > 100:
        raise ValueError(f'キーワードが{total_keywords}個あります。2つの欄を合わせて100個以内にしてください。')
    if keyword_limit is not None and total_keywords > keyword_limit:
        raise ValueError(f'キーワードが{total_keywords}個あります。2つの欄を合わせて{keyword_limit}個以内にしてください。')
    webhook = data.get('webhook_url', '')
    if not isinstance(webhook, str):
        raise ValueError('Discordの送信先URLは文字列で指定してください。')
    if webhook:
        validate_webhook(webhook)
    role = data.get('role_id', '')
    if not isinstance(role, str) or (role and not re.fullmatch(r'[0-9]{1,24}', role)):
        raise ValueError('メンションするDiscordロールIDは、数字で入力してください。')
    for name in ('include_replies', 'include_reposts', 'enabled'):
        if name in data and not isinstance(data[name], bool):
            raise ValueError('通知のオン・停止と、返信・リポストの設定はtrueまたはfalseで指定してください。')
    return dict(handle=handle, channel=channel.strip(), webhook_url=webhook, role_id=role,
                include_replies=data.get('include_replies', False), include_reposts=data.get('include_reposts', False),
                enabled=data.get('enabled', True), **keywords)


def matches_feed(post, feed):
    if not feed['enabled'] or post['author'].lower() != feed['handle'].lower():
        return False
    if post.get('kind') == 'unknown' and not (feed.get('include_replies') and feed.get('include_reposts')):
        return False
    if post.get('kind') == 'reply' and not feed.get('include_replies'):
        return False
    if post.get('kind') == 'repost' and not feed.get('include_reposts'):
        return False
    text = post['text'].casefold()
    if any(word.casefold() in text for word in feed.get('exclude', [])):
        return False
    return not feed.get('include') or any(word.casefold() in text for word in feed['include'])
