import unittest
from postrelay.security import validate_webhook, normalize_notification, matches_feed, verify_password, hash_password, validate_feed


class SecurityTests(unittest.TestCase):
    def test_malformed_url_errors_do_not_echo_sensitive_values(self):
        marker = 'SYNTHETIC_PRIVATE_MARKER'
        value = 'https://discord.com／api／webhooks／123／' + marker
        with self.assertRaises(ValueError) as caught:
            validate_webhook(value)
        self.assertNotIn(marker, str(caught.exception))
        post = {'id': '123', 'author': 'example', 'text': 'public',
                'url': 'https://x.com／' + marker}
        with self.assertRaises(ValueError) as caught:
            normalize_notification(post)
        self.assertNotIn(marker, str(caught.exception))

    def test_technical_keyword_cap_combines_include_and_exclude(self):
        feed = {'handle': 'example', 'channel': 'news',
                'include': [f'include{i}' for i in range(60)],
                'exclude': [f'exclude{i}' for i in range(40)]}
        self.assertEqual(len(validate_feed(feed)['include']), 60)
        with self.assertRaises(ValueError):
            validate_feed(dict(feed, exclude=feed['exclude'] + ['overflow']))

    def test_destination_is_exact_discord_https_endpoint(self):
        good = 'https://discord.com/api/webhooks/123456/abc_DEF-123'
        self.assertEqual(validate_webhook(good), good)
        for url in ['http://discord.com/api/webhooks/1/a', 'https://discord.com.evil.test/api/webhooks/1/a',
                    'https://127.0.0.1/api/webhooks/1/a', 'https://user@discord.com/api/webhooks/1/a',
                    'https://discord.com:8443/api/webhooks/1/a', 'https://discord.com/api/webhooks/1/a?redirect=x',
                    'https://discord.com/api/webhooks/1/a#x', 'https://discord.com/api/webhooks/1/a/../other']:
            with self.subTest(url=url), self.assertRaises(ValueError):
                validate_webhook(url)

    def test_password_hash_is_salted_and_verifiable(self):
        first, second = hash_password('a strong synthetic password'), hash_password('a strong synthetic password')
        self.assertNotEqual(first, second)
        self.assertTrue(verify_password('a strong synthetic password', first))
        self.assertFalse(verify_password('incorrect', first))

    def test_notification_requires_public_post_identity(self):
        post = normalize_notification({'id': '123', 'author': 'Example', 'text': 'hello',
                                       'url': 'https://x.com/Example/status/123'})
        self.assertEqual(post['author'], 'example')
        for change in [{'url': 'https://evil.test/a'}, {'id': '124'}, {'author': 'another'}, {'visibility': 'private'},
                       {'kind': 'dm'}, {'url': 'https://x.com/Example/status/123?x=y'}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                normalize_notification(dict(post, **change))

    def test_mapping_is_explicit_and_unknown_payload_is_rejected(self):
        raw = {'notification': {'tweet_id': '42', 'user': 'example', 'body': '募集のお知らせ',
                                'link': 'https://x.com/example/status/42'}}
        mapping = {'id': 'notification.tweet_id', 'author': 'notification.user',
                   'text': 'notification.body', 'url': 'notification.link'}
        self.assertEqual(normalize_notification(raw, mapping)['text'], '募集のお知らせ')
        with self.assertRaises(ValueError):
            normalize_notification(raw)

    def test_filters_are_case_insensitive_with_exclusion_precedence(self):
        feed = {'handle': 'example', 'include': ['募集', 'release'], 'exclude': ['広告'],
                'include_replies': False, 'include_reposts': False, 'enabled': True}
        post = {'author': 'example', 'text': 'RELEASE is here', 'kind': 'post'}
        self.assertTrue(matches_feed(post, feed))
        self.assertFalse(matches_feed(dict(post, text='RELEASE 広告'), feed))
        self.assertFalse(matches_feed(dict(post, kind='reply'), feed))
        self.assertFalse(matches_feed(dict(post, author='another'), feed))


if __name__ == '__main__':
    unittest.main()
