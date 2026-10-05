import json
import os
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from postrelay.store import Store


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


class ServerRuntimeTests(unittest.TestCase):
    def request(self, port, path, data=None, cookie='', host='localhost'):
        headers = {'Content-Type': 'application/json', 'X-PostRelay': '1'}
        if cookie:
            headers['Cookie'] = cookie
        req = Request(f'http://{host}:{port}' + path,
                      data=None if data is None else json.dumps(data).encode(), headers=headers)
        try:
            response = urlopen(req, timeout=2)
        except HTTPError as error:
            response = error
        with response:
            return response.status, json.loads(response.read()), response.headers

    def run_server(self, action, dual=False):
        main_port, push_port = free_port(), free_port()
        with tempfile.TemporaryDirectory() as folder:
            args = [sys.executable, '-B', '-m', 'postrelay', '--mode', 'selfhost',
                    '--data-dir', folder, '--port', str(main_port),
                    '--public-url', f'http://localhost:{main_port}']
            if dual:
                args += ['--host', '0.0.0.0', '--relay-web-push', '--capture-push',
                         '--push-port', str(push_port)]
            env = dict(os.environ, POSTRELAY_SIGNUP_KEY='synthetic-server-registration-key')
            process = subprocess.Popen(args, cwd=Path(__file__).resolve().parents[1],
                                       env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            try:
                deadline = time.monotonic() + 5
                while time.monotonic() < deadline:
                    if process.poll() is not None:
                        self.fail('Server exited before startup: ' + process.stderr.read().decode()[:400])
                    try:
                        if self.request(main_port, '/api/bootstrap')[0] == 200:
                            break
                    except (URLError, OSError):
                        time.sleep(.03)
                else:
                    self.fail('Server did not start in time.')
                action(main_port, push_port, process)
            finally:
                if process.poll() is None:
                    process.terminate()
                try:
                    process.communicate(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill(); process.communicate()
                process.stdout.close(); process.stderr.close()

    def test_free_oss_has_no_pricing_metadata_or_upgrade_endpoint(self):
        def check(main, push, process):
            _, bootstrap, _ = self.request(main, '/api/bootstrap')
            self.assertNotIn('plans', bootstrap)
            self.assertNotIn('billing', bootstrap)
            self.assertEqual(bootstrap['limits'], {'feeds': 2000, 'keywords': 100})
            _, user, headers = self.request(main, '/api/register',
                {'email': 'server@example.test', 'password': 'synthetic long password',
                 'signup_key': 'synthetic-server-registration-key'})
            self.assertNotIn('plan', user['user'])
            cookie = headers['Set-Cookie'].split(';', 1)[0]
            self.assertEqual(self.request(main, '/api/plan', {'plan': 'pro'}, cookie)[0], 404)
        self.run_server(check)

    def test_private_push_ingress_stays_off_public_dashboard_listener(self):
        def check(main, push, process):
            _, _, headers = self.request(main, '/api/register',
                {'email': 'server@example.test', 'password': 'synthetic long password',
                 'signup_key': 'synthetic-server-registration-key'})
            cookie = headers['Set-Cookie'].split(';', 1)[0]
            _, source, _ = self.request(main, '/api/source/rotate', {}, cookie)
            path = '/api/push/' + source['url'].rsplit('/', 1)[1]
            raw = {'data': {'uri': '/messages/123'}, 'body': 'SYNTHETIC PRIVATE FIXTURE'}
            self.assertEqual(self.request(main, path, raw)[0], 404)
            status, body, _ = self.request(push, path, raw, host='127.0.0.1')
            self.assertEqual((status, body), (202, {'captured': True, 'forwarded': False}))
            _, state, _ = self.request(main, '/api/state', cookie=cookie)
            self.assertEqual(state['jobs'], [])
            self.assertNotIn('SYNTHETIC PRIVATE FIXTURE', json.dumps(state))
        self.run_server(check, dual=True)

    def test_sigterm_exits_cleanly_for_container_stop(self):
        def check(main, push, process):
            process.send_signal(signal.SIGTERM)
            process.wait(timeout=5)
            self.assertEqual(process.returncode, 0)
        self.run_server(check)

    def test_legacy_paid_tier_becomes_free_without_losing_routes_or_source(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'state.sqlite'
            store = Store(path)
            owner = store.create_user('legacy@example.test', 'synthetic long password')
            feed = store.create_feed(owner['id'], {'handle': 'example', 'channel': 'news'})
            post = {'id': '123', 'author': 'example', 'text': 'public',
                    'url': 'https://x.com/example/status/123', 'kind': 'post', 'visibility': 'public'}
            store.ingest(owner['id'], post)
            with store.connection() as db:
                db.execute("UPDATE users SET plan='starter' WHERE id=?", (owner['id'],))
            migrated = Store(path)
            self.assertNotIn('plan', migrated.get_user(owner['id']))
            self.assertEqual(migrated.user_for_source(owner['source_token'])['id'], owner['id'])
            self.assertEqual(migrated.list_feeds(owner['id'])[0]['id'], feed['id'])
            self.assertEqual(len(migrated.list_jobs(owner['id'])), 1)
            # A legacy tier must not preserve the old20-keyword commercial restriction.
            migrated.update_feed(owner['id'], feed['id'], {'include': [str(i) for i in range(30)]})
