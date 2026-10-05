import json
import math
import time
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener, HTTPRedirectHandler
from .security import validate_webhook


@dataclass
class DeliveryResult:
    state: str
    error: str = ''
    delay: float = 0


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def discord_message(job):
    post = job['post']
    # The payload contains only notification text, not an assumed full tweet or media expansion.
    message = {'embeds': [{'title': '@' + post['author'], 'description': post['text'][:4000],
                           'url': post['url'], 'color': 13981467,
                           'footer': {'text': 'PostRelay · 投稿通知'}}], 'allowed_mentions': {'parse': []}}
    if job.get('role_id'):
        message['content'] = '<@&' + job['role_id'] + '>'
        message['allowed_mentions']['roles'] = [job['role_id']]
    return message


def send_discord(job):
    if not job.get('webhook_url'):
        return DeliveryResult('failed', 'Discordの送信先URLが未設定です。送信先を設定してください。')
    try:
        url = validate_webhook(job['webhook_url'])
    except ValueError:
        return DeliveryResult('failed', 'Discordの送信先URLの形式が正しくありません。Discordで取得したURLを確認してください。')
    request = Request(url + '?wait=true', data=json.dumps(discord_message(job)).encode(),
                      headers={'Content-Type': 'application/json', 'User-Agent': 'PostRelay/0.1'}, method='POST')
    try:
        # Do not honor proxy env variables or follow redirects to an arbitrary destination.
        from urllib.request import ProxyHandler
        with build_opener(ProxyHandler({}), NoRedirect()).open(request, timeout=10) as response:
            response.read(32768)
            if 200 <= response.status < 300:
                return DeliveryResult('delivered')
            return DeliveryResult('failed', 'Discordが送信を受け付けませんでした。送信先URLを確認してください。')
    except HTTPError as error:
        try:
            if error.code == 429:
                delay = 30.0
                try:
                    raw = json.loads(error.read(32768))
                    value = float(raw.get('retry_after', 30))
                    if math.isfinite(value):
                        delay = max(1, min(value, 86400))
                except (ValueError, TypeError):
                    pass
                return DeliveryResult('retry', 'Discordへの送信件数が一時的な制限に達しました。自動でもう一度送信します。', delay)
            if error.code >= 500:
                return DeliveryResult('retry', 'Discordが一時的に利用できません。自動でもう一度送信します。')
            return DeliveryResult('failed', f'Discordが送信を受け付けませんでした（HTTP {error.code}）。送信先URLを確認してください。')
        finally:
            error.close()
    except (URLError, TimeoutError, OSError):
        # Never return exception text: it can include the secret webhook URL.
        return DeliveryResult('retry', 'Discordへの接続に失敗しました。自動でもう一度送信します。')


class Worker:
    def __init__(self, store, mode='demo', sender=None, max_attempts=8):
        self.store, self.mode, self.sender, self.max_attempts = store, mode, sender, max_attempts

    def tick(self, now=None):
        now = time.time() if now is None else now
        job = self.store.claim_job(now)
        if not job:
            return False
        if self.sender:
            try:
                result = self.sender(job)
            except Exception:
                result = DeliveryResult('retry', '送信処理を完了できませんでした。自動でもう一度送信します。')
        elif self.mode == 'demo':
            result = DeliveryResult('simulated')
        else:
            result = send_discord(job)
        if result.state == 'retry' and job['attempts'] >= self.max_attempts:
            result = DeliveryResult('failed', f'{job["attempts"]}回試しても送信できませんでした。Discordの送信先を確認して、もう一度送信してください。')
        delay = result.delay or min(5 * 2 ** min(job['attempts'] - 1, 10), 1800)
        self.store.finish_job(job['id'], job['lease'], result.state, result.error, delay, now)
        return True

    def run(self, stop):
        next_cleanup = 0
        while not stop.is_set():
            try:
                if time.monotonic() >= next_cleanup:
                    self.store.purge_push_inbox()
                    next_cleanup = time.monotonic() + 60
                worked = self.tick()
            except Exception:
                # Keep operational logs free of request bodies and secrets. A queued job remains durable.
                worked = False
            stop.wait(0.25 if worked else 1)
