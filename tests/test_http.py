import json
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from postrelay.store import Store
from postrelay.server import make_server


class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.temp.name) / 'test.sqlite')
        self.server = make_server(self.store, port=0, mode='selfhost')
        self.base = self.server.app.public_url
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def request(self, path, payload=None, cookie='', origin=None, custom=True):
        headers = {'Content-Type': 'application/json'}
        if custom:
            headers['X-PostRelay'] = '1'
        if origin:
            headers['Origin'] = origin
        if cookie:
            headers['Cookie'] = cookie
        req = Request(self.base + path, data=None if payload is None else json.dumps(payload).encode(), headers=headers)
        try:
            response = urlopen(req, timeout=5)
        except HTTPError as error:
            response = error
        with response:
            return response.status, json.loads(response.read()), response.headers

    def register(self, email):
        status, body, headers = self.request('/api/register', {'email': email, 'password': 'a long synthetic password'})
        self.assertEqual(status, 200)
        return body['user'], headers['Set-Cookie'].split(';')[0]

    def test_csrf_and_anonymous_access_are_rejected(self):
        self.assertEqual(self.request('/api/state')[0], 401)
        data = {'email': 'test@example.test', 'password': 'a long synthetic password'}
        self.assertEqual(self.request('/api/register', data, origin='https://evil.test')[0], 403)
        self.assertEqual(self.request('/api/register', data, custom=False)[0], 403)

    def test_two_workspaces_and_private_ingest(self):
        first, cookie = self.register('first@example.test')
        second, other_cookie = self.register('second@example.test')
        status, feed, _ = self.request('/api/feeds', {'handle': 'example', 'channel': 'news'}, cookie)
        self.assertEqual(status, 201)
        self.assertEqual(self.request('/api/feeds/' + feed['id'], {'enabled': False}, other_cookie)[0], 404)
        _, source, _ = self.request('/api/source/rotate', {}, cookie)
        path = source['url'][len(self.base):]
        payload = {'id': '10', 'author': 'example', 'text': 'test notice', 'url': 'https://x.com/example/status/10'}
        self.assertEqual(self.request(path, payload, custom=False)[0], 202)
        self.assertEqual(self.request(path, payload, custom=False)[1]['duplicate'], True)
        self.assertEqual(self.request('/api/hooks/bad', payload, custom=False)[0], 401)
        _, state, _ = self.request('/api/state', cookie=other_cookie)
        self.assertEqual(state['jobs'], [])
        _, state, _ = self.request('/api/state', cookie=cookie)
        self.assertEqual(len(state['jobs']), 1)
        self.assertNotIn('source_hash', json.dumps(state))
        self.assertNotIn('password_hash', json.dumps(state))

    def test_source_rotation_revokes_old_url_and_removed_plan_route_is_unavailable(self):
        _, cookie = self.register('user@example.test')
        _, old, _ = self.request('/api/source/rotate', {}, cookie)
        self.request('/api/source/rotate', {}, cookie)
        payload = {'id': '10', 'author': 'example', 'text': 'test', 'url': 'https://x.com/example/status/10'}
        self.assertEqual(self.request(old['url'][len(self.base):], payload)[0], 401)
        self.assertEqual(self.request('/api/plan', {'plan': 'pro'}, cookie)[0], 404)


if __name__ == '__main__':
    unittest.main()
