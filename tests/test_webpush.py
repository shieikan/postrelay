import unittest
from postrelay.webpush import normalize_web_push, PushUnavailable
from postrelay.security import matches_feed


def embed(author='thsottiaux', post_id='123', text='Public post text'):
    return {'url': f'https://x.com/{author}/status/{post_id}',
            'author_url': f'https://x.com/{author}', 'type': 'rich',
            'html': f'<blockquote><p>{text}</p>footer</blockquote>'}


class WebPushTests(unittest.TestCase):
    def test_verified_public_text_replaces_untrusted_notification_body(self):
        payload = {'body': 'PRIVATE NOTIFICATION MUST NOT LEAVE',
                   'data': {'url': '/thsottiaux/status/123?ref_src=push'}}
        resolver = lambda url: embed(text='Public &amp; verified<br>second line')
        post = normalize_web_push(payload, {'thsottiaux'}, resolver)
        self.assertEqual(post['author'], 'thsottiaux')
        self.assertEqual(post['id'], '123')
        self.assertEqual(post['text'], 'Public & verified\nsecond line')
        self.assertNotIn('PRIVATE', str(post))

    def test_id_only_link_requires_public_author_proof(self):
        payload = {'data': {'url': 'https://x.com/i/web/status/123'}}
        post = normalize_web_push(payload, {'thsottiaux'}, lambda url: embed())
        self.assertEqual(post['url'], 'https://x.com/thsottiaux/status/123')
        with self.assertRaises(PushUnavailable):
            normalize_web_push(payload, {'thsottiaux'}, lambda url: embed(author='other'))

    def test_observed_uri_shape_requires_the_same_public_identity_check(self):
        post = normalize_web_push({'data': {'uri': '/thsottiaux/status/123'}, 'body': 'PRIVATE'},
                                  {'thsottiaux'}, lambda url: embed())
        self.assertEqual(post['id'], '123')
        self.assertNotIn('PRIVATE', str(post))
        with self.assertRaises(PushUnavailable):
            normalize_web_push({'data': {'uri': '/thsottiaux/status/124',
                                        'url': '/thsottiaux/status/123'}},
                               {'thsottiaux'}, lambda url: embed())

    def test_dm_external_url_and_other_account_do_not_trigger_network(self):
        urls = ['/messages/123', '//evil.test/thsottiaux/status/123',
                'https://x.com.evil.test/thsottiaux/status/123',
                'https://x.com@evil.test/thsottiaux/status/123',
                'https://x.com:443/thsottiaux/status/123',
                'https://[malformed/thsottiaux/status/123',
                'http://x.com/thsottiaux/status/123', '/other/status/123']
        for url in urls:
            calls = []
            def resolver(value):
                calls.append(value)
                return embed()
            with self.subTest(url=url), self.assertRaises(PushUnavailable):
                normalize_web_push({'data': {'url': url}}, {'thsottiaux'}, resolver)
            self.assertEqual(calls, [])

    def test_mismatched_or_unavailable_public_evidence_never_becomes_a_post(self):
        payload = {'data': {'url': '/thsottiaux/status/123'}}
        invalid = [embed(post_id='124'), embed(author='other'),
                   dict(embed(), author_url='https://x.com/other'),
                   dict(embed(), author_url=123),
                   dict(embed(), author_url='https://[malformed'),
                   dict(embed(), html='<script>private</script>'),
                   dict(embed(), type='link'), {}]
        for evidence in invalid:
            with self.subTest(evidence=evidence), self.assertRaises(PushUnavailable):
                normalize_web_push(payload, {'thsottiaux'}, lambda url: evidence)

    def test_unknown_shapes_are_not_guessed(self):
        for payload in [{}, {'url':'/thsottiaux/status/123'}, {'data': {'url': 123}},
                        {'raw': 'Tibo said something'}, {'notification': {'body': 'Tibo'}}]:
            with self.assertRaises(PushUnavailable):
                normalize_web_push(payload, {'thsottiaux'}, lambda url: embed())

    def test_unknown_post_kind_does_not_bypass_reply_or_repost_filters(self):
        post = normalize_web_push({'data': {'url': '/thsottiaux/status/123'}},
                                  {'thsottiaux'}, lambda url: embed())
        for replies, reposts in [(False, False), (True, False), (False, True), (True, True)]:
            feed = dict(enabled=True, handle='thsottiaux', include_replies=replies, include_reposts=reposts)
            self.assertEqual(matches_feed(post, feed), replies and reposts)


if __name__ == '__main__':
    unittest.main()
