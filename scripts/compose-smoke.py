"""Exercise an isolated CI Compose project using synthetic data only."""
import json
import os
import subprocess
import time
from http.client import HTTPConnection
from http.cookies import SimpleCookie


def compose(*args):
    subprocess.run(['docker', 'compose', '-p', 'postrelay', *args], check=True, timeout=120)


def main():
    # This helper is only for an ephemeral Actions runner, never existing deployments.
    if os.environ.get('GITHUB_ACTIONS') != 'true':
        raise SystemExit('Run this isolated smoke check in GitHub Actions only.')
    base = 'http://localhost:8765'
    cookie = ''

    def request(path, data=None, expected=200):
        headers = {'X-PostRelay': '1', 'Content-Type': 'application/json'}
        if cookie:
            headers['Cookie'] = cookie
        connection = HTTPConnection('localhost', 8765, timeout=5)
        try:
            connection.request('GET' if data is None else 'POST', path,
                               body=None if data is None else json.dumps(data), headers=headers)
            response = connection.getresponse()
            assert response.status == expected, f'Unexpected HTTP status on {path.split("/")[2]}'
            return json.loads(response.read()), dict(response.getheaders())
        finally:
            connection.close()

    compose('up', '-d', '--wait', 'postrelay')
    try:
        bootstrap, _ = request('/api/bootstrap')
        assert bootstrap['source']['web_push'] and bootstrap['mode'] == 'selfhost'
        _, headers = request('/api/register', {'email': 'ci@example.test',
            'password': 'synthetic ci long password', 'signup_key': os.environ['POSTRELAY_SIGNUP_KEY']})
        parsed = SimpleCookie(); parsed.load(headers['Set-Cookie'])
        cookie = 'postrelay_session=' + parsed['postrelay_session'].value
        request('/api/feeds', {'handle': 'demo_ci', 'channel': 'ci-only',
                'include_replies': True, 'include_reposts': True}, 201)
        source, _ = request('/api/source/rotate', {})
        path = source['url'][len(base):]
        result, _ = request(path, {'id': '123456789', 'author': 'demo_ci',
                    'text': 'Synthetic persistence check.', 'url': 'https://x.com/demo_ci/status/123456789'}, 202)
        assert result['queued'] == 1
        # Empty webhook means failed locally; no external Discord request occurs.
        deadline = time.monotonic() + 15
        while True:
            before, _ = request('/api/state')
            if before['jobs'] and before['jobs'][0]['state'] == 'failed':
                break
            assert time.monotonic() < deadline, 'Local worker did not settle.'
            time.sleep(0.25)
        request('/api/push/synthetic-invalid-token', {}, 404)
        # Check the receiver loopback namespace without adding Python to the Rust source image.
        private_check = """from urllib.request import Request, urlopen
from urllib.error import HTTPError
request = Request('http://127.0.0.1:8767/api/push/synthetic-invalid-token',
                  data=b'{}', headers={'Content-Type': 'application/json'})
try:
    urlopen(request, timeout=3)
except HTTPError as error:
    assert error.code == 401
else:
    raise AssertionError('Private ingress did not reject the invalid token')
"""
        compose('exec', '-T', 'postrelay', 'python', '-c', private_check)
        compose('restart', 'postrelay')
        compose('up', '-d', '--wait', 'postrelay')
        after, _ = request('/api/state')
        assert after['user']['id'] == before['user']['id']
        assert after['feeds'] == before['feeds'] and after['jobs'] == before['jobs']
        print(json.dumps({'health': True, 'session_feed_history_preserved': True,
                          'public_push_status': 404, 'private_bad_token_status': 401,
                          'external_notifications_sent': 0}))
    finally:
        # No volumes are deleted. The ephemeral runner owns this project.
        compose('down')


if __name__ == '__main__':
    main()
