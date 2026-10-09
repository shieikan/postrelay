import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readConfig, verifyNotification, discordMessage, matchesFeed, validateWebhook, resolvePublicEmbed, sendDiscord } from '../src/core.js';

const feed = { id: 'demo', handle: 'demo_studio', webhook_url: 'https://discord.com/api/webhooks/123/example',
  include: [], exclude: [], role_id: '', enabled: true, allow_unknown_kind: true };
const embed = (overrides = {}) => ({ type: 'rich', url: 'https://x.com/demo_studio/status/123',
  author_url: 'https://x.com/demo_studio', html: '<blockquote><p>Public &amp; verified<br>second line</p>Footer</blockquote>', ...overrides });

test('only independently verified public text is forwarded; private push text never leaves', async () => {
  const post = await verifyNotification({ body: 'PRIVATE DM BODY', title: 'Private name',
    data: { uri: '/demo_studio/status/123?source=push' } }, [feed], async () => embed());
  assert.equal(post.text, 'Public & verified\nsecond line');
  assert.equal(post.kind, 'unknown');
  assert.equal(post.url, 'https://x.com/demo_studio/status/123');
  const message = discordMessage(post, feed);
  assert.deepEqual(message.allowed_mentions, { parse: [] });
  assert.doesNotMatch(JSON.stringify(message), /PRIVATE|Private name|Footer/);
});

test('public lookup failures are bounded, do not follow redirects and retain interrupted work for retry', async t => {
  let response;
  const mock = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url.origin, 'https://publish.x.com');
    assert.equal(options.redirect, 'manual');
    assert.ok(options.signal);
    return response;
  });
  response = new Response(null, { status: 302, headers: { Location: 'https://untrusted.example/private' } });
  await assert.rejects(() => resolvePublicEmbed('https://x.com/demo_studio/status/123'), error => error.code === 'public_lookup_failed' && !error.retryable);
  response = new Response(new ReadableStream({ start(controller) { controller.error(new Error('PRIVATE_NETWORK_DETAILS')); } }));
  await assert.rejects(() => resolvePublicEmbed('https://x.com/demo_studio/status/123'), error => error.code === 'invalid_response' && error.retryable);
  response = new Response('a'.repeat(65537));
  await assert.rejects(() => resolvePublicEmbed('https://x.com/demo_studio/status/123'), error => error.code === 'invalid_response');
  assert.equal(mock.mock.callCount(), 3);
});

test('Discord uses a confirmed webhook response, honors retry_after and never follows redirects', async t => {
  const post = { id: '123', author: 'demo_studio', url: 'https://x.com/demo_studio/status/123', text: 'Public post' };
  let response;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, feed.webhook_url + '?wait=true');
    assert.equal(options.redirect, 'manual');
    assert.ok(options.signal);
    return response;
  });
  response = Response.json({ retry_after: 2.5 }, { status: 429 });
  assert.deepEqual(await sendDiscord(post, feed), { state: 'retry', error: 'discord_rate_limit', delay: 2500 });
  response = new Response(null, { status: 302, headers: { Location: 'https://untrusted.example' } });
  assert.equal((await sendDiscord(post, feed)).state, 'failed');
  response = new Response(null, { status: 503 });
  assert.equal((await sendDiscord(post, feed)).state, 'retry');
});

test('DMs, external destinations, conflicting URLs and unconfigured authors do not trigger fetch', async () => {
  let calls = 0;
  for (const url of ['/messages/123', '//evil.test/demo_studio/status/123',
    'https://x.com.evil.test/demo_studio/status/123', 'https://x.com@evil.test/demo_studio/status/123',
    'https://x.com:443/demo_studio/status/123', 'http://x.com/demo_studio/status/123',
    '/other/status/123', '/demo_studio/status/123\n', '/demo_studio/status/../123']) {
    await assert.rejects(() => verifyNotification({ data: { url } }, [feed], async () => { calls++; return embed(); }));
  }
  await assert.rejects(() => verifyNotification({ data: { url: '/demo_studio/status/123', uri: '/demo_studio/status/124' } }, [feed], async () => { calls++; return embed(); }));
  assert.equal(calls, 0);
});

test('id-only links require matching public author proof; unsupported evidence fails closed', async () => {
  const payload = { data: { url: 'https://x.com/i/web/status/123' } };
  const post = await verifyNotification(payload, [feed], async () => embed());
  assert.equal(post.author, 'demo_studio');
  for (const evidence of [embed({ url: 'https://x.com/other/status/123' }),
    embed({ url: 'https://x.com/demo_studio/status/124' }), embed({ author_url: 'https://x.com/other' }),
    embed({ html: '<p><script>unsafe</script></p>' }), embed({ html: '<p>unclosed' }),
    embed({ type: 'link' }), {}, null]) {
    await assert.rejects(() => verifyNotification(payload, [feed], async () => evidence));
  }
});

test('unverified push authors and bodies cannot substitute for public evidence', async () => {
  for (const payload of [{}, { url: '/demo_studio/status/123' }, { data: { url: 123 } },
    { notification: { body: 'Public-looking but private' } }]) {
    await assert.rejects(() => verifyNotification(payload, [feed], async () => embed()));
  }
});

test('configuration is strict, generic, and requires explicit unknown-kind consent', () => {
  assert.equal(readConfig(JSON.stringify({ feeds: [feed] })).feeds[0].handle, 'demo_studio');
  for (const value of [{ feeds: [{ ...feed, allow_unknown_kind: false }] },
    { feeds: [{ ...feed, allow_unknown_kind: undefined }] }, { feeds: [feed, feed] },
    { feeds: [{ ...feed, enabled: 'false' }] }, { feeds: [{ ...feed, typo: true }] },
    { feeds: [] }, { feeds: Array.from({ length: 21 }, (_, i) => ({ ...feed, id: `f${i}` })) }]) {
    assert.throws(() => readConfig(JSON.stringify(value)));
  }
});

test('identifiers and public-author evidence reject trailing whitespace', async () => {
  for (const field of ['id', 'handle', 'role_id']) {
    const value = field === 'role_id' ? '123\n' : feed[field] + '\n';
    assert.throws(() => readConfig(JSON.stringify({ feeds: [{ ...feed, [field]: value }] })));
  }
  await assert.rejects(() => verifyNotification({ data: { uri: '/demo_studio/status/123' } }, [feed],
    async () => embed({ author_url: 'https://x.com/demo_studio\n' })));
});

test('only exact Discord webhook destinations are accepted', () => {
  assert.equal(validateWebhook(feed.webhook_url), feed.webhook_url);
  for (const url of [feed.webhook_url + '?redirect=1', feed.webhook_url + '#x',
    feed.webhook_url.replace('discord.com', 'discord.com.evil.test'),
    feed.webhook_url.replace('discord.com', 'discord.com:443'),
    feed.webhook_url.replace('https:', 'http:'), 'https://127.0.0.1/api/webhooks/123/abc',
    'https://discord.com/api/webhooks/123/a/../secret']) assert.throws(() => validateWebhook(url));
});

test('filters apply to verified public content, exclusions win and mentions are opt-in', () => {
  const post = { author: 'demo_studio', text: 'Release for Everyone', id: '123',
    url: 'https://x.com/demo_studio/status/123', kind: 'unknown' };
  assert.equal(matchesFeed(post, { ...feed, include: ['release'] }), true);
  assert.equal(matchesFeed(post, { ...feed, include: ['release'], exclude: ['EVERYONE'] }), false);
  assert.equal(matchesFeed(post, { ...feed, enabled: false }), false);
  assert.equal(matchesFeed(post, { ...feed, handle: 'other' }), false);
  assert.equal(matchesFeed(post, { ...feed, allow_unknown_kind: false }), false);
  assert.deepEqual(discordMessage(post, { ...feed, role_id: '1234' }).allowed_mentions, { parse: [], roles: ['1234'] });
});
