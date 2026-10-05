import tempfile
import unittest
from pathlib import Path
from postrelay.store import Store


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / 'data.sqlite'
        self.store = Store(self.path)
        self.owner = self.store.create_user('one@example.test', 'a long synthetic password', 'starter')
        self.other = self.store.create_user('two@example.test', 'a long synthetic password', 'starter')
        self.feed = self.store.create_feed(self.owner['id'], {'handle': 'example', 'channel': 'news'})
        self.post = {'id': '123', 'author': 'example', 'text': 'new release',
                     'url': 'https://x.com/example/status/123', 'kind': 'post', 'visibility': 'public'}

    def tearDown(self):
        self.temp.cleanup()

    def test_workspace_isolation_and_secret_redaction(self):
        self.assertEqual(self.store.list_feeds(self.other['id']), [])
        with self.assertRaises(KeyError):
            self.store.update_feed(self.other['id'], self.feed['id'], {'enabled': False})
        self.assertNotIn('password_hash', self.owner)
        self.assertNotIn('webhook_url', self.store.list_feeds(self.owner['id'])[0])
        self.assertIsNone(self.store.user_for_source('wrong-token'))

    def test_ingestion_is_durable_and_replay_does_not_duplicate(self):
        self.assertEqual(self.store.ingest(self.owner['id'], self.post)['queued'], 1)
        self.assertEqual(self.store.ingest(self.owner['id'], self.post)['queued'], 0)
        reopened = Store(self.path)
        jobs = reopened.list_jobs(self.owner['id'])
        self.assertEqual(len(jobs), 1)
        self.assertEqual(jobs[0]['state'], 'queued')
        self.assertEqual(reopened.list_jobs(self.other['id']), [])

    def test_expired_lease_is_reclaimed_but_active_lease_is_not(self):
        self.store.ingest(self.owner['id'], self.post, now=100)
        job = self.store.claim_job(now=100, lease_seconds=30)
        self.assertIsNotNone(job)
        self.assertIsNone(self.store.claim_job(now=101))
        resumed = Store(self.path).claim_job(now=131)
        self.assertEqual(resumed['id'], job['id'])
        self.assertEqual(resumed['attempts'], 2)

    def test_history_identifies_rules_with_the_same_route_after_edit(self):
        second = self.store.create_feed(self.owner['id'], {'handle': 'example', 'channel': 'news'})
        self.store.ingest(self.owner['id'], self.post)
        self.store.update_feed(self.owner['id'], self.feed['id'], {'handle': 'renamed', 'channel': 'updates'})
        jobs = self.store.list_jobs(self.owner['id'])
        self.assertEqual({job['feed_id'] for job in jobs}, {self.feed['id'], second['id']})
        self.assertEqual(len([job for job in jobs if job['feed_id'] == self.feed['id']]), 1)
        self.assertEqual(self.store.list_jobs(self.other['id']), [])

    def test_plan_limits_and_keyword_caps_are_server_side(self):
        with self.assertRaises(ValueError):
            self.store.create_feed(self.owner['id'], {'handle': 'a', 'channel': 'b',
                                                     'include': [str(i) for i in range(21)]})
        for index in range(99):
            self.store.create_feed(self.owner['id'], {'handle': f'user{index}', 'channel': 'news'})
        with self.assertRaises(ValueError):
            self.store.create_feed(self.owner['id'], {'handle': 'overflow', 'channel': 'news'})

    def test_existing_failure_can_be_retried_only_by_its_owner(self):
        self.store.ingest(self.owner['id'], self.post, now=100)
        job = self.store.claim_job(now=100)
        self.store.finish_job(job['id'], job['lease'], 'failed', 'Destination rejected', now=100)
        with self.assertRaises(KeyError):
            self.store.retry_job(self.other['id'], job['id'], now=101)
        self.store.retry_job(self.owner['id'], job['id'], now=101)
        self.assertEqual(self.store.claim_job(now=101)['attempts'], 1)

    def test_stale_worker_cannot_overwrite_reclaimed_job(self):
        self.store.ingest(self.owner['id'], self.post, now=100)
        old = self.store.claim_job(now=100, lease_seconds=1)
        new = self.store.claim_job(now=102)
        self.assertFalse(self.store.finish_job(old['id'], old['lease'], 'delivered', now=102))
        self.assertTrue(self.store.finish_job(new['id'], new['lease'], 'delivered', now=102))

    def test_paused_backlog_does_not_starve_active_feed(self):
        for index in range(101):
            self.store.ingest(self.owner['id'], dict(self.post, id=str(200 + index)), now=100)
        self.store.update_feed(self.owner['id'], self.feed['id'], {'enabled': False})
        self.store.create_feed(self.other['id'], {'handle': 'example', 'channel': 'other'})
        self.store.ingest(self.other['id'], self.post, now=101)
        self.assertEqual(self.store.claim_job(now=102)['user_id'], self.other['id'])

    def test_database_symlink_is_rejected(self):
        link = Path(self.temp.name) / 'link.sqlite'
        link.symlink_to(self.path)
        with self.assertRaises(ValueError):
            Store(link)


if __name__ == '__main__':
    unittest.main()
