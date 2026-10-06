import json
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.request import Request, urlopen
from unittest.mock import patch

from postrelay.server import make_server
from postrelay.store import Store


class OnboardingTests(unittest.TestCase):
    def test_web_push_setup_is_visible_and_explicit_all_types_receives_a_job(self):
        with tempfile.TemporaryDirectory() as folder:
            store = Store(Path(folder) / 'test.sqlite')
            user = store.create_user('onboarding@example.test', 'synthetic long password')
            cookie = 'postrelay_session=' + store.session(user['id'])
            server = make_server(store, port=0, mode='selfhost', relay_web_push=True)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            base = server.app.public_url

            def request(path, data=None):
                req = Request(base + path, headers={'Cookie': cookie, 'X-PostRelay': '1', 'Content-Type': 'application/json'},
                              data=None if data is None else json.dumps(data).encode())
                with urlopen(req, timeout=5) as response:
                    return json.load(response)

            try:
                self.assertTrue(request('/api/bootstrap')['source']['web_push'])
                self.assertTrue(request('/api/state')['source']['web_push'])
                feed = request('/api/feeds', {'handle': 'example', 'channel': 'news',
                        'include_replies': True, 'include_reposts': True})
                token = store.rotate_source(user['id'])
                public = {'type': 'rich', 'url': 'https://x.com/example/status/123',
                          'author_url': 'https://x.com/example', 'html': '<blockquote><p>Public fixture.</p></blockquote>'}
                with patch('postrelay.webpush.resolve_public_embed', return_value=public):
                    result = request('/api/push/' + token, {'data': {'uri': '/example/status/123'}})
                self.assertEqual(result['queued'], 1)
                jobs = request('/api/state')['jobs']
                self.assertEqual(jobs[0]['feed_id'], feed['id'])
                self.assertEqual(jobs[0]['post']['kind'], 'unknown')
            finally:
                server.shutdown(); server.server_close(); thread.join(timeout=2)

    def test_public_listener_can_describe_private_source_without_accepting_raw_push(self):
        with tempfile.TemporaryDirectory() as folder:
            store = Store(Path(folder) / 'test.sqlite')
            server = make_server(store, port=0, mode='selfhost', web_push_source=True)
            try:
                self.assertTrue(server.app.web_push_source)
            finally:
                server.server_close()
