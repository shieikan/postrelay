import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runtime } from './runtime-harness.js';

test('SQLite leases survive restart, reject stale completions and cap retries', async t => {
  const { inspect, restart } = await runtime(t);
  const call = async (operation, ...args) => (await inspect('store', { operation, args })).value;
  await call('accept', { id: '1', url: 'https://x.com/demo_studio/status/1' }, 0);
  const first = await call('claimPost', 0);
  await restart();
  assert.equal(await call('claimPost', 59999), null);
  const second = await call('claimPost', 60001);
  assert.notEqual(second.lease, first.lease);
  await call('resolvePost', first, { id: '1', text: 'Stale data' }, [{ id: 'demo', hash: 'old' }], 60002);
  assert.deepEqual(await call('counts', 'jobs'), {});
  await call('resolvePost', second, { id: '1', text: 'Public data' }, [{ id: 'demo', hash: 'destination' }], 60003);
  const oldJob = await call('claimJob', 60003);
  const currentJob = await call('claimJob', 120004);
  await call('finish', 'jobs', oldJob, { state: 'delivered' }, 120005);
  assert.equal(await call('meta', 'last_delivered_at'), null, 'a stale completion cannot mark a delivery');
  assert.deepEqual(await call('counts', 'jobs'), { sending: 1 });
  await call('finish', 'jobs', currentJob, { state: 'retry', error: 'discord_unavailable' }, 120006);
  for (let attempt = 3; attempt <= 8; attempt++) {
    const job = await call('claimJob', attempt * 1000000);
    assert.equal(job.attempts, attempt);
    await call('finish', 'jobs', job, { state: 'retry', error: 'discord_unavailable' }, attempt * 1000000 + 1);
  }
  assert.deepEqual(await call('counts', 'jobs'), { failed: 1 });
  assert.equal(await call('claimJob', 100000000), null);
  await call('retryFailed', 100000001);
  assert.equal((await call('claimJob', 100000002)).attempts, 1);
});

test('a full job queue cannot partially resolve a post or discard the existing backlog', async t => {
  const { inspect } = await runtime(t);
  const call = async (operation, ...args) => (await inspect('store', { operation, args })).value;
  const targets = Array.from({ length: 20 }, (_, i) => ({ id: `feed${i}`, hash: `destination${i}` }));
  for (let id = 1; id <= 50; id++) {
    const post = { id: String(id), url: `https://x.com/demo_studio/status/${id}`, text: 'Public content' };
    await call('accept', post, 0);
    await call('resolvePost', await call('claimPost', 1), post, targets, 2);
  }
  assert.deepEqual(await call('counts', 'jobs'), { queued: 1000 });
  const post = { id: '51', url: 'https://x.com/demo_studio/status/51', text: 'Additional public post' };
  await call('accept', post, 3);
  const claimed = await call('claimPost', 4);
  const result = await inspect('store', { operation: 'resolvePost', args: [claimed, post, targets, 5] });
  assert.equal(result.error, 'queue_full');
  assert.equal(await call('post', '51'), null);
  assert.deepEqual(await call('counts', 'posts'), { resolved: 50, sending: 1 });
  await call('cleanup', 9 * 24 * 60 * 60 * 1000);
  assert.equal((await call('post', '1')).text, 'Public content', 'pending jobs keep the public text needed for delivery');
  assert.deepEqual(await call('counts', 'jobs'), { queued: 1000 });
});

test('interrupted attempts also stop after eight leases; queue limits preserve pending work', async t => {
  const { inspect } = await runtime(t);
  const call = async (operation, ...args) => (await inspect('store', { operation, args })).value;
  await call('accept', { id: '1', url: 'https://x.com/demo_studio/status/1' }, 0);
  for (let attempt = 1; attempt <= 8; attempt++) {
    const row = await call('claimPost', attempt * 60001);
    assert.equal(row.attempts, attempt);
  }
  assert.equal(await call('claimPost', 10 * 60001), null);
  assert.deepEqual(await call('counts', 'posts'), { failed: 1 });
  const batch = Array.from({ length: 1001 }, (_, i) => ({ operation: 'accept', args: [
    { id: String(i + 2), url: `https://x.com/demo_studio/status/${i + 2}` }, 0,
  ] }));
  const accepted = await inspect('store', batch);
  assert.equal(accepted.filter(result => result.value === true).length, 1000);
  assert.equal(accepted.at(-1).error, 'queue_full');
  assert.equal(await call('accept', { id: '2', url: 'https://x.com/demo_studio/status/2' }, 1), false, 'duplicates remain harmless at the limit');
  const retry = await inspect('store', { operation: 'retryFailed', args: [1] });
  assert.equal(retry.error, 'queue_full');
  assert.deepEqual(await call('counts', 'posts'), { failed: 1, queued: 1000 });
  await call('cleanup', 9 * 24 * 60 * 60 * 1000);
  assert.deepEqual(await call('counts', 'posts'), { queued: 1000 }, 'retention removes terminal records without dropping pending work');
});

async function storeCalls(inspect, operations) {
  const results = await inspect('store', operations);
  for (const result of results) assert.equal(result.error, undefined);
  return results.map(result => result.value);
}

async function failedPosts(inspect, firstId, count, now) {
  for (let offset = 0; offset < count; offset += 1000) {
    const size = Math.min(1000, count - offset);
    await storeCalls(inspect, Array.from({ length: size }, (_, i) => ({ operation: 'accept', args: [
      { id: String(firstId + offset + i), url: `https://x.com/demo_studio/status/${firstId + offset + i}` }, now,
    ] })));
    for (let attempt = 1; attempt <= 8; attempt++) {
      const rows = await storeCalls(inspect, Array.from({ length: size }, () => ({ operation: 'claimPost', args: [now] })));
      assert.ok(rows.every(row => row?.attempts === attempt));
      await storeCalls(inspect, rows.map(row => ({ operation: 'finish', args: [
        'posts', row, { state: 'retry', error: 'public_lookup_failed', delay: 1 }, now,
      ] })));
      now += 2;
    }
  }
  return now;
}

test('retry recovers more than one thousand failed posts in bounded batches without deleting the remainder', { timeout: 45000 }, async t => {
  const { inspect, command } = await runtime(t);
  await failedPosts(inspect, 1, 1001, Date.now());
  assert.deepEqual((await command('status')).value.posts, { failed: 1001 });
  const first = await command('retry');
  assert.equal(first.status, 202);
  assert.deepEqual(first.value.posts, { failed: 1, queued: 1000 });
  const pending = await inspect();
  const remainder = pending.posts.find(row => row.state === 'failed');
  assert.equal(remainder.id, '1001', 'older failures should be restarted first');
  assert.equal(remainder.attempts, 8);
  assert.ok(pending.posts.filter(row => row.state === 'queued').every(row => row.attempts === 0 && row.lease === null));

  const due = Date.now() + 1000;
  const [row] = await storeCalls(inspect, [{ operation: 'claimPost', args: [due] }]);
  await storeCalls(inspect, [{ operation: 'finish', args: ['posts', row, { state: 'ignored', error: 'not_public_post' }, due + 1] }]);
  const second = await command('retry');
  assert.equal(second.status, 202);
  assert.deepEqual(second.value.posts, { ignored: 1, queued: 1000 });
  assert.equal((await inspect()).posts.length, 1001, 'retry must not discard retained posts');
});

test('a full post queue does not block job recovery or replace active job leases', { timeout: 45000 }, async t => {
  const { inspect, command } = await runtime(t);
  let now = Date.now();
  const createJobs = async (firstId, count, failed) => {
    await storeCalls(inspect, Array.from({ length: count }, (_, i) => ({ operation: 'accept', args: [
      { id: String(firstId + i), url: `https://x.com/demo_studio/status/${firstId + i}` }, now,
    ] })));
    const rows = await storeCalls(inspect, Array.from({ length: count }, () => ({ operation: 'claimPost', args: [now] })));
    await storeCalls(inspect, rows.map(row => ({ operation: 'resolvePost', args: [row,
      { id: row.id, url: row.url, text: 'Public content' }, [{ id: 'demo', hash: 'destination' }], now,
    ] })));
    if (failed) {
      const jobs = await storeCalls(inspect, Array.from({ length: count }, () => ({ operation: 'claimJob', args: [now] })));
      await storeCalls(inspect, jobs.map(row => ({ operation: 'finish', args: ['jobs', row, { state: 'failed', error: 'discord_rejected' }, now] })));
    }
    now += 2;
  };
  await createJobs(2000, 1000, true);
  await createJobs(3000, 1, true);
  await createJobs(4000, 100, false);
  const [sending, retrying] = await storeCalls(inspect, Array.from({ length: 2 }, () => ({ operation: 'claimJob', args: [now] })));
  await storeCalls(inspect, [{ operation: 'finish', args: ['jobs', retrying, { state: 'retry', error: 'discord_unavailable', delay: 1000000 }, now] }]);
  now = await failedPosts(inspect, 5000, 1, now);
  await storeCalls(inspect, Array.from({ length: 1000 }, (_, i) => ({ operation: 'accept', args: [
    { id: String(6000 + i), url: `https://x.com/demo_studio/status/${6000 + i}` }, now,
  ] })));
  const before = await inspect();
  const activeJobs = before.jobs.filter(row => ['queued', 'retry', 'sending'].includes(row.state));
  const first = await command('retry');
  assert.equal(first.status, 202, 'one full queue must not roll back progress in the other');
  assert.deepEqual(first.value.posts, { failed: 1, queued: 1000, resolved: 1101 });
  assert.deepEqual(first.value.jobs, { failed: 101, queued: 998, retry: 1, sending: 1 });
  const after = await inspect();
  for (const job of activeJobs) assert.deepEqual(after.jobs.find(row => row.id === job.id), job);
  assert.equal(after.jobs.find(row => row.id === sending.id).lease, sending.lease);
  const full = await command('retry');
  assert.equal(full.status, 400);
  assert.equal(full.value.error, 'queue_full');

  const due = Date.now() + 1000;
  const [completed] = await storeCalls(inspect, [{ operation: 'claimJob', args: [due] }]);
  await storeCalls(inspect, [{ operation: 'finish', args: ['jobs', completed, { state: 'delivered' }, due + 1] }]);
  const second = await command('retry');
  assert.equal(second.status, 202);
  assert.deepEqual(second.value.jobs, { delivered: 1, failed: 100, queued: 998, retry: 1, sending: 1 });
  assert.equal((await inspect()).jobs.length, 1101, 'the remaining failures stay available for later batches');
});
