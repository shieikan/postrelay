import tempfile
import unittest
import io
from unittest.mock import patch
from urllib.error import HTTPError
from pathlib import Path
from postrelay.store import Store
from postrelay.engine import Worker, DeliveryResult, discord_message, send_discord, NoRedirect


class EngineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.temp.name) / 'data.sqlite')
        self.user = self.store.create_user('test@example.test', 'a long synthetic password')
        self.store.create_feed(self.user['id'], {'handle': 'example', 'channel': 'news',
                                                'webhook_url': 'https://discord.com/api/webhooks/123/abc'})
        self.post = {'id': '1', 'author': 'example', 'text': '@everyone new release',
                     'url': 'https://x.com/example/status/1', 'kind': 'post', 'visibility': 'public'}
        self.store.ingest(self.user['id'], self.post, now=100)

    def tearDown(self):
        self.temp.cleanup()

    def test_rate_limit_retry_survives_restart_and_does_not_run_early(self):
        worker = Worker(self.store, sender=lambda job: DeliveryResult('retry', 'Rate limited', 20))
        worker.tick(now=100)
        self.assertEqual(self.store.list_jobs(self.user['id'])[0]['state'], 'retry')
        calls = []
        worker = Worker(Store(self.store.path), sender=lambda job: calls.append(job) or DeliveryResult('delivered', ''))
        self.assertFalse(worker.tick(now=119))
        self.assertTrue(worker.tick(now=120))
        self.assertEqual(len(calls), 1)
        self.assertEqual(self.store.list_jobs(self.user['id'])[0]['state'], 'delivered')

    def test_demo_never_calls_live_sender_and_is_labeled_simulated(self):
        worker = Worker(self.store, mode='demo')
        worker.tick(now=100)
        self.assertEqual(self.store.list_jobs(self.user['id'])[0]['state'], 'simulated')

    def test_missing_live_destination_fails_without_simulated_success(self):
        other = self.store.create_user('other@example.test', 'a long synthetic password')
        self.store.create_feed(other['id'], {'handle': 'example', 'channel': 'news'})
        self.store.ingest(other['id'], self.post, now=100)
        self.store.claim_job(now=100)  # hold first user's job, process second
        Worker(self.store, mode='live').tick(now=100)
        self.assertEqual(self.store.list_jobs(other['id'])[0]['state'], 'failed')

    def test_mentions_are_suppressed_by_default(self):
        payload = discord_message({'post': self.post, 'role_id': ''})
        self.assertEqual(payload['allowed_mentions'], {'parse': []})
        self.assertNotIn('content', payload)
        permitted = discord_message({'post': self.post, 'role_id': '1234'})
        self.assertEqual(permitted['allowed_mentions'], {'parse': [], 'roles': ['1234']})

    def test_max_attempts_is_a_terminal_failure(self):
        worker = Worker(self.store, sender=lambda job: DeliveryResult('retry', 'Unavailable', 1), max_attempts=2)
        worker.tick(now=100)
        worker.tick(now=101)
        self.assertEqual(self.store.list_jobs(self.user['id'])[0]['state'], 'failed')

    def test_http_429_retry_after_and_errors_never_expose_webhook(self):
        url = 'https://discord.com/api/webhooks/123/synthetic_secret'
        job = {'post': self.post, 'webhook_url': url, 'role_id': ''}
        for code, body, expected in [(429, b'{"retry_after":17}', 'retry'), (500, b'broken', 'retry'), (403, b'denied', 'failed'), (302, b'redirect', 'failed')]:
            with self.subTest(code=code), patch('postrelay.engine.build_opener') as factory:
                factory.return_value.open.side_effect = HTTPError(url, code, 'error', {}, io.BytesIO(body))
                result = send_discord(job)
                self.assertEqual(result.state, expected)
                self.assertNotIn('synthetic_secret', result.error)
                if code == 429:
                    self.assertEqual(result.delay, 17)

    def test_redirects_are_not_followed(self):
        self.assertIsNone(NoRedirect().redirect_request(None, None, 302, '', {}, 'https://127.0.0.1/private'))


if __name__ == '__main__':
    unittest.main()
