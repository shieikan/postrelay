import json
import tempfile
import threading
import unittest
from unittest.mock import patch
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from postrelay.store import Store
from postrelay.server import make_server


class PushInboxTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.temp.name) / 'test.sqlite')
        self.first = self.store.create_user('first@example.test', 'synthetic long password')
        self.second = self.store.create_user('second@example.test', 'synthetic long password')

    def tearDown(self):
        self.temp.cleanup()

    def post(self, server, path, payload):
        request = Request(server.app.public_url + path,
                          data=json.dumps(payload).encode(),
                          headers={'Content-Type': 'application/json'})
        try:
            response = urlopen(request, timeout=5)
        except HTTPError as error:
            response = error
        with response:
            return response.status, json.loads(response.read())

    def run_capture(self, action, enabled=True, relay=False):
        server = make_server(self.store, port=0, mode='selfhost', capture_push=enabled,
                             relay_web_push=relay)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            action(server)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_authenticated_capture_never_queues_or_returns_private_payload(self):
        self.store.create_feed(self.first['id'], {'handle': 'thsottiaux', 'channel': 'dev-general'})
        raw = {'notification': {'body': 'synthetic private fixture', 'url': '/messages'}}
        def check(server):
            status, result = self.post(server, '/api/push/' + self.first['source_token'], raw)
            self.assertEqual(status, 202)
            self.assertEqual(result, {'captured': True, 'forwarded': False})
            self.assertEqual(self.store.list_jobs(self.first['id']), [])
            with self.store.connection() as db:
                rows = db.execute('SELECT user_id,payload FROM push_inbox').fetchall()
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]['user_id'], self.first['id'])
            self.assertEqual(json.loads(rows[0]['payload']), raw)
            _, body = self.post(server, '/api/push/bad-token', raw)
            self.assertNotIn('synthetic private fixture', json.dumps(body))
        self.run_capture(check)

    def test_bad_revoked_and_disabled_tokens_do_not_capture(self):
        def check(server):
            path = '/api/push/' + self.first['source_token']
            self.assertEqual(self.post(server, '/api/push/bad-token', {'test': True})[0], 401)
            self.store.rotate_source(self.first['id'])
            self.assertEqual(self.post(server, path, {'test': True})[0], 401)
            with self.store.connection() as db:
                self.assertEqual(db.execute('SELECT COUNT(*) FROM push_inbox').fetchone()[0], 0)
        self.run_capture(check)
        self.run_capture(lambda server: self.assertEqual(
            self.post(server, '/api/push/' + self.second['source_token'], {'test': True})[0], 404), enabled=False)

    def test_capture_is_local_selfhost_only(self):
        with self.assertRaises(ValueError):
            make_server(self.store, port=0, mode='demo', capture_push=True)
        with self.assertRaises(ValueError):
            make_server(self.store, host='0.0.0.0', port=0, mode='selfhost', capture_push=True)
        with self.assertRaises(ValueError):
            make_server(self.store, host='0.0.0.0', port=0, mode='selfhost', relay_web_push=True)

    def test_verified_push_queues_once_with_public_text_only(self):
        self.store.create_feed(self.first['id'], {'handle': 'thsottiaux', 'channel': 'dev-general',
                               'include_replies': True, 'include_reposts': True})
        evidence = {'url': 'https://x.com/thsottiaux/status/123',
                    'author_url': 'https://x.com/thsottiaux', 'type': 'rich',
                    'html': '<blockquote><p>Verified public text</p></blockquote>'}
        payload = {'data': {'url': '/thsottiaux/status/123'}, 'body': 'PRIVATE FIXTURE'}
        def check(server):
            with patch('postrelay.webpush.resolve_public_embed', return_value=evidence):
                status, result = self.post(server, '/api/push/' + self.first['source_token'], payload)
                self.assertEqual(status, 202)
                self.assertTrue(result['verified_public_post'])
                self.assertFalse(result['duplicate'])
                self.assertTrue(self.post(server, '/api/push/' + self.first['source_token'], payload)[1]['duplicate'])
            jobs = self.store.list_jobs(self.first['id'])
            self.assertEqual(len(jobs), 1)
            self.assertEqual(jobs[0]['post']['kind'], 'unknown')
            self.assertNotIn('PRIVATE FIXTURE', json.dumps(jobs))
            with self.store.connection() as db:
                self.assertEqual(db.execute('SELECT COUNT(*) FROM push_inbox').fetchone()[0], 0)
        self.run_capture(check, relay=True)

    def test_failed_public_verification_quarantines_without_queue(self):
        from postrelay.webpush import PushUnavailable
        self.store.create_feed(self.first['id'], {'handle': 'thsottiaux', 'channel': 'dev-general'})
        def check(server):
            with patch('postrelay.webpush.resolve_public_embed', side_effect=PushUnavailable('unavailable')):
                status, result = self.post(server, '/api/push/' + self.first['source_token'],
                                          {'data': {'url': '/thsottiaux/status/123'}, 'body': 'PRIVATE FIXTURE'})
            self.assertEqual((status, result), (202, {'captured': True, 'forwarded': False}))
            self.assertEqual(self.store.list_jobs(self.first['id']), [])
            with self.store.connection() as db:
                self.assertEqual(db.execute('SELECT COUNT(*) FROM push_inbox').fetchone()[0], 1)
        self.run_capture(check, relay=True)

    def test_unverified_push_is_rejected_when_capture_disabled(self):
        def check(server):
            status, result = self.post(server, '/api/push/' + self.first['source_token'],
                                      {'data': {'url': '/messages/123'}, 'body': 'PRIVATE FIXTURE'})
            self.assertEqual(status, 422)
            self.assertNotIn('PRIVATE FIXTURE', json.dumps(result))
            self.assertEqual(self.store.list_jobs(self.first['id']), [])
        self.run_capture(check, enabled=False, relay=True)

    def test_capacity_expiry_and_user_isolation(self):
        for index in range(23):
            self.store.capture_push(self.first['id'], {'fixture': index}, now=1000 + index)
        self.store.capture_push(self.second['id'], {'fixture': 'other'}, now=1024)
        with self.store.connection() as db:
            first = db.execute('SELECT payload FROM push_inbox WHERE user_id=? ORDER BY received',
                               (self.first['id'],)).fetchall()
            other = db.execute('SELECT COUNT(*) FROM push_inbox WHERE user_id=?', (self.second['id'],)).fetchone()[0]
        self.assertEqual(len(first), 20)
        self.assertEqual(json.loads(first[0]['payload'])['fixture'], 3)
        self.assertEqual(other, 1)
        self.store.purge_push_inbox(now=1023 + 86400)
        with self.store.connection() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM push_inbox').fetchone()[0], 1)


if __name__ == '__main__':
    unittest.main()
