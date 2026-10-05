"""Accept documented data.url and observed data.uri, verifying public identity.

Notification bodies can contain private names or message text. Only text from
the public X oEmbed response is eligible for delivery; unknown shapes fail closed.
"""
import json
import re
from html.parser import HTMLParser
from urllib.parse import urlencode, urlsplit
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener, ProxyHandler
from .engine import NoRedirect
from .security import normalize_notification


class PushUnavailable(ValueError):
    pass


def status_identity(value):
    if not isinstance(value, str) or len(value) > 2048:
        raise PushUnavailable('投稿URLを確認できません。')
    try:
        parsed = urlsplit(value)
    except ValueError:
        raise PushUnavailable('投稿URLを確認できません。') from None
    if parsed.scheme or parsed.netloc:
        if parsed.scheme != 'https' or parsed.netloc not in {'x.com', 'twitter.com'}:
            raise PushUnavailable('Xの公開投稿URLではありません。')
    elif not value.startswith('/') or value.startswith('//'):
        raise PushUnavailable('Xの公開投稿URLではありません。')
    match = re.fullmatch(r'/([A-Za-z0-9_]{1,15})/status/([0-9]{1,19})', parsed.path)
    if match:
        return match[1].lower(), match[2]
    match = re.fullmatch(r'/i/web/status/([0-9]{1,19})', parsed.path)
    if match:
        return None, match[1]
    raise PushUnavailable('投稿への直接リンクではありません。')


class PublicText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.active, self.finished, self.invalid = False, False, False
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag == 'p' and not self.finished:
            self.active = True
        if self.active and tag in {'script', 'style', 'iframe'}:
            self.invalid = True
        if self.active and tag == 'br':
            self.parts.append('\n')

    def handle_endtag(self, tag):
        if tag == 'p' and self.active:
            self.active, self.finished = False, True

    def handle_data(self, data):
        if self.active:
            self.parts.append(data)


def resolve_public_embed(url):
    endpoint = 'https://publish.x.com/oembed?' + urlencode({'url': url, 'omit_script': 'true'})
    try:
        request = Request(endpoint, headers={'User-Agent': 'PostRelay/0.1'})
        with build_opener(ProxyHandler({}), NoRedirect()).open(request, timeout=5) as response:
            raw = response.read(65537)
        if len(raw) > 65536:
            raise PushUnavailable('公開投稿の確認データが大きすぎます。')
        value = json.loads(raw)
        if not isinstance(value, dict):
            raise PushUnavailable('公開投稿を確認できません。')
        return value
    except HTTPError as error:
        error.close()
        raise PushUnavailable('Xから公開投稿を確認できませんでした。') from None
    except (URLError, OSError, TimeoutError, ValueError):
        # Never put requested URLs, response bodies or exception details in logs.
        raise PushUnavailable('Xから公開投稿を確認できませんでした。') from None


def normalize_web_push(payload, allowed_authors, resolver=None):
    data = payload.get('data') if isinstance(payload, dict) else None
    if not isinstance(data, dict):
        raise PushUnavailable('未対応の通知形式です。')
    target = data.get('url') if 'url' in data else data.get('uri')
    claimed_author, post_id = status_identity(target)
    if 'url' in data and 'uri' in data and status_identity(data['uri']) != (claimed_author, post_id):
        raise PushUnavailable('通知に含まれる投稿URLが一致しません。')
    allowed = {author.lower() for author in allowed_authors}
    if not allowed or (claimed_author is not None and claimed_author not in allowed):
        raise PushUnavailable('通知するアカウントの投稿ではありません。')
    target_url = f'https://x.com/{claimed_author}/status/{post_id}' if claimed_author else f'https://x.com/i/web/status/{post_id}'
    evidence = (resolver or resolve_public_embed)(target_url)
    if not isinstance(evidence, dict) or evidence.get('type') != 'rich':
        raise PushUnavailable('公開投稿を確認できません。')
    actual_author, actual_id = status_identity(evidence.get('url'))
    author_url = evidence.get('author_url')
    if not isinstance(author_url, str) or len(author_url) > 2048:
        raise PushUnavailable('公開投稿の投稿者を確認できません。')
    try:
        author_link = urlsplit(author_url)
    except ValueError:
        raise PushUnavailable('公開投稿の投稿者を確認できません。') from None
    if (actual_author is None or actual_author not in allowed or actual_id != post_id
            or (claimed_author is not None and actual_author != claimed_author)
            or author_link.scheme != 'https' or author_link.netloc not in {'x.com', 'twitter.com'}
            or author_link.path.lower() != '/' + actual_author or author_link.query or author_link.fragment):
        raise PushUnavailable('公開投稿の投稿者を確認できません。')
    markup = evidence.get('html')
    if not isinstance(markup, str) or len(markup) > 65536:
        raise PushUnavailable('公開投稿の本文を確認できません。')
    parser = PublicText()
    parser.feed(markup)
    text = ''.join(parser.parts).strip()
    if parser.invalid or not parser.finished or not text:
        raise PushUnavailable('公開投稿の本文を確認できません。')
    post = normalize_notification({'id': post_id, 'author': actual_author,
        'url': f'https://x.com/{actual_author}/status/{post_id}', 'text': text[:4000],
        'kind': 'post', 'visibility': 'public'})
    # oEmbed proves public identity/content, but cannot prove reply/repost kind.
    # Keep that uncertainty internal; the generic ingest API still rejects it.
    post['kind'] = 'unknown'
    return post
