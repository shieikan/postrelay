import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as core from '../src/core.js';

const feed = { id: 'demo', handle: 'demo_studio', webhook_url: 'https://discord.com/api/webhooks/123/example',
  include: [], exclude: [], role_id: '', enabled: true, allow_unknown_kind: true };
const post = { id: '123', author: 'demo_studio', url: 'https://x.com/demo_studio/status/123',
  text: 'Verified public text', kind: 'unknown', visibility: 'public' };
const avatar = 'https://pbs.twimg.com/profile_images/123/avatar_normal.png';
const evidence = (overrides = {}) => ({ __typename: 'Tweet', id_str: '123',
  user: { id_str: '456', screen_name: 'Demo_Studio', name: '公開スタジオ', profile_image_url_https: avatar }, ...overrides });

test('oEmbed supplies the public display name; push titles and icons never supply identity', async () => {
  const result = await core.verifyNotification({ title: 'PRIVATE NAME', icon: 'https://private.invalid/icon',
    data: { url: post.url } }, [feed], async () => ({ type: 'rich', url: post.url,
    author_url: 'https://x.com/demo_studio', author_name: '公開スタジオ', html: '<p>Verified public text</p>' }));
  assert.equal(result.author_name, '公開スタジオ');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|private.invalid/);
});

test('matching public metadata decorates Discord author without changing the webhook sender', async () => {
  const result = await core.enrichAuthor(post, async () => evidence());
  assert.equal(result.author_id, '456');
  assert.equal(result.author_name, '公開スタジオ');
  assert.equal(result.author_icon, avatar);
  const message = core.discordMessage(result, feed);
  assert.deepEqual(message.embeds[0].author, { name: '公開スタジオ (@demo_studio)', url: 'https://x.com/demo_studio', icon_url: avatar });
  assert.equal(message.embeds[0].url, post.url);
  assert.equal(message.embeds[0].description, post.text);
  assert.equal(message.username, undefined);
  assert.equal(message.avatar_url, undefined);
  assert.deepEqual(message.allowed_mentions, { parse: [] });
  assert.equal(post.author_name, undefined, 'the input must not be mutated');
});

test('metadata is tied to the top-level post and author, never quoted/reposted author data', async () => {
  for (const value of [null, {}, evidence({ id_str: '124' }), evidence({ id_str: 123 }),
    evidence({ __typename: 'TweetTombstone' }), evidence({ user: { ...evidence().user, screen_name: 'other' } }),
    evidence({ user: { ...evidence().user, id_str: 456 } }),
    evidence({ user: { ...evidence().user, id_str: '456\n' } }),
    { quoted_tweet: evidence() }]) {
    assert.deepEqual(await core.enrichAuthor(post, async () => value), post);
  }
  const result = await core.enrichAuthor(post, async () => evidence({ quoted_tweet: evidence({ user: { name: 'Other' } }) }));
  assert.equal(result.author_name, '公開スタジオ');
});

test('metadata failures keep public names or old handle-only jobs deliverable', async () => {
  const named = { ...post, author_name: 'oEmbed Name' };
  assert.deepEqual(await core.enrichAuthor(named, async () => { throw new Error('PRIVATE DETAILS'); }), named);
  assert.equal((await core.enrichAuthor(named, async () => evidence())).author_name, 'oEmbed Name');
  const message = core.discordMessage(post, feed);
  assert.equal(message.embeds[0].author.name, '@demo_studio');
  assert.equal(message.embeds[0].author.icon_url, undefined);
});

test('invalid or deceptive optional names and avatar URLs are omitted without losing the post', async () => {
  for (const name of [null, {}, '', '  ', 'A\nB', 'A\u202eB', 'A\u2066B', 'x'.repeat(201)]) {
    const result = await core.enrichAuthor(post, async () => evidence({ user: { ...evidence().user, name } }));
    assert.equal(result.author_name, undefined);
    assert.equal(core.discordMessage(result, feed).embeds[0].author.name, '@demo_studio');
  }
  for (const url of ['https://evil.test/icon.png', avatar + '?x=1', avatar + '#x', avatar + '\n',
    avatar.replace('https:', 'http:'), avatar.replace('pbs.twimg.com', 'pbs.twimg.com.evil.test'),
    avatar.replace('pbs.twimg.com', 'pbs.twimg.com:443'), avatar.replace('/123/', '/123/../'),
    avatar.replace('/profile_images/', '/media/'), 'https://pbs.twimg.com/profile_images/123/a.svg']) {
    const result = await core.enrichAuthor(post, async () => evidence({ user: { ...evidence().user, profile_image_url_https: url } }));
    assert.equal(result.author_icon, undefined, url);
    assert.equal(core.discordMessage({ ...post, author_icon: url }, feed).embeds[0].author.icon_url, undefined);
  }
  assert.ok(core.discordMessage({ ...post, author_name: '🌸'.repeat(100) }, feed).embeds[0].author.name.length <= 256);
});

test('public profile fetch is fixed-host, unauthenticated, bounded and never follows redirects', async t => {
  let response = Response.json(evidence());
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls++;
    assert.equal(url.origin, 'https://cdn.syndication.twimg.com');
    assert.equal(url.pathname, '/tweet-result');
    assert.equal(url.searchParams.get('id'), '123');
    assert.equal(options.redirect, 'manual');
    assert.ok(options.signal);
    assert.equal(new Headers(options.headers).has('Cookie'), false);
    assert.equal(new Headers(options.headers).has('Authorization'), false);
    return response;
  });
  assert.equal((await core.enrichAuthor(post)).author_icon, avatar);
  for (const r of [new Response(null, { status: 302, headers: { Location: 'https://evil.test' } }),
    new Response(null, { status: 429 }), new Response('bad json'), new Response('x'.repeat(65537)),
    new Response(new ReadableStream({ start(c) { c.error(new Error('private')); } }))]) {
    response = r;
    assert.deepEqual(await core.enrichAuthor(post), post);
  }
  await assert.rejects(() => core.resolvePublicAuthor('123&url=https://evil.test'));
  assert.equal(calls, 6);
});
