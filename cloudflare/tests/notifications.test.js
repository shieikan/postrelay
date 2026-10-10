import assert from 'node:assert/strict';
import { test } from 'node:test';
import { notificationBatch, verifyCandidate } from '../src/notifications.js';
import { readConfig, matchesFeed, discordMessage, enrichAuthor } from '../src/core.js';

const feed = { id: 'demo', handle: 'demo_studio', webhook_url: 'https://discord.com/api/webhooks/123/synthetic', enabled: true, allow_unknown_kind: true, include_reposts: true, include: [], exclude: [], role_id: '' };
export function fixture() {
  return { globalObjects: { users: {
    '10': { id_str: '10', screen_name: 'demo_studio', protected: false },
    '20': { id_str: '20', screen_name: 'original', protected: false },
    '30': { id_str: '30', screen_name: 'outsider', protected: false },
  }, tweets: {
    '100': { id_str: '100', user_id_str: '10', retweeted_status_id_str: '90', full_text: 'PRIVATE PUSH TEXT' },
    '90': { id_str: '90', user_id_str: '20', full_text: 'PRIVATE API TEXT' },
    '101': { id_str: '101', user_id_str: '30', retweeted_status_id_str: '90' },
    '102': { id_str: '102', user_id_str: '10', quoted_status_id_str: '90' },
  } }, timeline: { instructions: [{ addEntries: { entries: [
    { entryId: 'tweet-100', sortIndex: '1000', content: { item: { content: { tweet: { id: '100' } } } } },
  ] } }] } };
}
const evidence = { type: 'rich', url: 'https://x.com/original/status/90', author_url: 'https://x.com/original', author_name: 'Original Person', html: '<blockquote><p>Verified public text</p>footer</blockquote>' };

test('opt-in reposts retain actor from X structural relationship, never private text', async () => {
  assert.equal(readConfig(JSON.stringify({ feeds: [feed] })).feeds[0].include_reposts, true);
  const batch = notificationBatch(fixture(), [feed], 999, 2000);
  assert.equal(batch.watermark, 1000);
  assert.deepEqual(batch.candidates, [{ id: '100', url: 'https://x.com/original/status/90', reposted_by: 'demo_studio' }]);
  const post = await verifyCandidate(batch.candidates[0], [feed], async () => evidence);
  assert.equal(post.author, 'original'); assert.equal(post.id, '100'); assert.equal(post.original_id, '90');
  assert.equal(matchesFeed(post, feed), true);
  assert.equal(matchesFeed(post, { ...feed, include_reposts: false }), false);
  assert.equal(matchesFeed(post, { ...feed, handle: 'original' }), false);
  const msg = discordMessage(post, feed);
  assert.match(msg.embeds[0].footer.text, /@demo_studio.*リポスト/);
  assert.equal(msg.embeds[0].author.name, 'Original Person (@original)');
  assert.doesNotMatch(JSON.stringify(msg), /PRIVATE/);
  let lookupId;
  await enrichAuthor(post, async id => { lookupId = id; return {}; });
  assert.equal(lookupId, '90');
});

test('only top-level configured public reposts qualify; quoted and nested records confer no authority', () => {
  for (const mutate of [
    v => { v.globalObjects.users['10'].protected = true; },
    v => { v.globalObjects.users['20'].protected = true; },
    v => { v.globalObjects.tweets['100'].user_id_str = '30'; },
    v => { delete v.globalObjects.tweets['90']; },
    v => { v.globalObjects.tweets['100'].id_str = '101'; },
    v => { v.globalObjects.users['10'].id_str = '30'; },
    v => { v.globalObjects.users['20'].screen_name = 'original\n'; },
    v => { v.globalObjects.tweets['90'].retweeted_status_id_str = '80'; },
  ]) { const v = fixture(); mutate(v); assert.deepEqual(notificationBatch(v, [feed], 999, 2000).candidates, []); }
  assert.deepEqual(notificationBatch(fixture(), [{ ...feed, include_reposts: false }], 999, 2000).candidates, []);
  assert.deepEqual(notificationBatch(fixture(), [feed], 1001, 2000).candidates, []);
  const quote = fixture(); quote.globalObjects.tweets['100'] = { id_str:'100', user_id_str:'10', quoted_status_id_str:'90' };
  assert.deepEqual(notificationBatch(quote, [feed], 999, 2000).candidates, [{ id:'100', url:'https://x.com/demo_studio/status/100' }]);
  assert.throws(() => notificationBatch({}, [feed], 0, 2000), /notification_sync_invalid/);
});

test('a later poll can discover another repost at the same millisecond watermark', () => {
  const first = notificationBatch(fixture(), [feed], 999, 2000);
  const later = fixture();
  later.globalObjects.tweets['101'] = { ...later.globalObjects.tweets['100'], id_str: '101' };
  later.timeline.instructions[0].addEntries.entries[0] = { entryId: 'tweet-101', sortIndex: '1000',
    content: { item: { content: { tweet: { id: '101' } } } } };
  const second = notificationBatch(later, [feed], first.watermark, 2000);
  assert.deepEqual(second.candidates.map(post => post.id), ['101']);
  assert.equal(second.watermark, first.watermark);
});

test('repost public-original verification rejects mismatches, disabled actor and unproven push-like data', async () => {
  const row = notificationBatch(fixture(), [feed], 999, 2000).candidates[0];
  await assert.rejects(verifyCandidate(row, [{ ...feed, enabled:false }], async () => evidence));
  await assert.rejects(verifyCandidate(row, [feed], async () => ({ ...evidence, author_url: 'https://x.com/outsider' })));
  await assert.rejects(verifyCandidate({ ...row, id:'90' }, [feed], async () => evidence));
  await assert.rejects(verifyCandidate({ id:'90', url:row.url }, [feed], async () => evidence));
});
