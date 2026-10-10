import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runtime, waitFor, feed } from './runtime-harness.js';

test('a healthy socket remains connected and delivers after the handshake deadline', { timeout: 25000 }, async t => {
  const { command, ready, mockCommand, emit } = await runtime(t);
  await command('start'); await ready();
  await new Promise(resolve => setTimeout(resolve, 11200));
  assert.equal((await command('status')).value.connected, true);
  assert.equal((await mockCommand('state')).connections, 1, 'the healthy socket must not be replaced');
  await emit('110');
  const delivered = await waitFor(() => mockCommand('state'), value => value.messages.length === 1, 'later notification should deliver');
  assert.equal(delivered.messages[0].embeds[0].url, 'https://x.com/demo_studio/status/110');
  assert.deepEqual(delivered.unexpected, []);
  await command('stop');
});

test('workerd: authenticated setup, real WebSocket receive, private-content exclusion, persistence and recovery', { timeout: 45000 }, async (t) => {
  const { command, mockCommand, inspect, emit, restart } = await runtime(t);
  assert.equal((await command('start', false)).status, 401);
  assert.equal((await command('status')).value.enabled, false);
  assert.equal((await mockCommand('state')).connections, 0);
  assert.equal((await command('start')).status, 202);
  await waitFor(() => command('status'), value => value.value.connected, 'source should connect');
  let state = await mockCommand('state');
  assert.equal(state.registrations.length, 1);
  assert.deepEqual(state.unexpected, []);
  await emit('123');
  state = await waitFor(() => mockCommand('state'), value => value.messages.length === 1 && value.acks.length === 1, 'verified post should be delivered and acknowledged');
  assert.equal(state.messages[0].embeds[0].description, 'Public post 123');
  assert.deepEqual(state.messages[0].embeds[0].author, { name: 'Demo Studio (@demo_studio)',
    url: 'https://x.com/demo_studio', icon_url: 'https://pbs.twimg.com/profile_images/456/demo_normal.png' });
  assert.equal(state.profileRequests, 1);
  assert.doesNotMatch(JSON.stringify(state.messages), /PRIVATE/);
  assert.deepEqual(state.messages[0].allowed_mentions, { parse: [] });
  const stored = await inspect();
  assert.doesNotMatch(JSON.stringify(stored), /PRIVATE|synthetic_cookie|synthetic_csrf|api\/webhooks|privateKey/);
  assert.equal(stored.jobs[0].state, 'delivered');
  await emit('123', { body: 'PRIVATE AGAIN', version: 'duplicate' });
  await waitFor(() => mockCommand('state'), value => value.acks.length === 2, 'duplicate should be acknowledged');
  assert.equal((await mockCommand('state')).messages.length, 1);
  assert.equal((await mockCommand('state')).profileRequests, 1, 'duplicates do not re-fetch metadata');

  // A public-lookup outage must not lose the notification or persist its private body.
  await mockCommand('options', { embedStatus: 503 });
  await emit('124');
  await waitFor(() => inspect(), value => value.posts.some(row => row.id === '124' && row.state === 'retry'), 'failed lookup should retry');
  assert.doesNotMatch(JSON.stringify(await inspect()), /PRIVATE/);
  await mockCommand('options', { embedStatus: 200, discordStatus: 429, retryAfter: 2 });
  await inspect('due');
  await waitFor(() => inspect(), value => value.jobs.some(row => row.post_id === '124' && row.state === 'retry'), 'Discord rate limit should retain the job');
  assert.deepEqual((await command('status')).value.job_errors, { discord_rate_limit: 1 });
  await command('stop');
  const beforeRestart = await inspect();
  assert.equal(beforeRestart.jobs.find(row => row.post_id === '124').state, 'retry');
  await restart();
  assert.equal((await command('status')).value.enabled, false);
  assert.equal((await command('status')).value.registered, true, 'saved registration remains visible while stopped after restart');
  assert.equal((await mockCommand('state')).connections, 0);
  assert.equal((await inspect()).jobs.find(row => row.post_id === '124').state, 'retry');
  await command('start');
  await inspect('due');
  state = await waitFor(() => mockCommand('state'), value => value.messages.length === 1, 'persistent pending job should resume');
  assert.equal(state.messages[0].embeds[0].url, 'https://x.com/demo_studio/status/124');
  assert.equal(state.messages[0].embeds[0].author.icon_url, 'https://pbs.twimg.com/profile_images/456/demo_normal.png');
  assert.equal(state.profileRequests, 0, 'retry after restart uses stored public author metadata');
  await command('stop');
  assert.equal((await command('status')).value.enabled, false);
});

test('every management route is authenticated; methods, queries and test paths are rejected', async t => {
  const { command, fetch, mockCommand } = await runtime(t);
  for (const action of ['status', 'start', 'stop', 'retry']) {
    assert.equal((await command(action, false)).status, 401);
    assert.equal((await command(action, true, action === 'status' ? 'POST' : 'GET')).status, 405);
    assert.equal((await command(action + '?x=1')).status, 404);
  }
  assert.equal((await fetch('/__test/inspect')).status, 404);
  const health = await fetch('/health');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { service: 'PostRelay', status: 'ok' });
  assert.equal((await mockCommand('state')).connections, 0);
});

test('a persisted alarm resumes enabled work after a full runtime restart without a start command', async t => {
  const { command, ready, mockCommand, emit, inspect, restart } = await runtime(t);
  await mockCommand('options', { discordStatus: 429, retryAfter: 600 });
  await command('start'); await ready();
  await emit('150');
  await waitFor(() => inspect(), value => value.jobs[0]?.state === 'retry', 'job should be saved before restart');
  await inspect('restart-alarm');
  await restart();
  const delivered = await waitFor(() => mockCommand('state'), value => value.messages.length === 1, 'saved alarm should run recovery without a management request');
  assert.equal(delivered.messages[0].embeds[0].url, 'https://x.com/demo_studio/status/150');
  assert.equal((await command('status')).value.enabled, true);
  await ready();
  assert.equal((await mockCommand('state')).registrations.length, 0, 'the existing subscription should be resumed');
  await command('stop');
});

test('multiple feeds and repeated start share one connection; Mozilla backoff persists across restart', async t => {
  const { command, ready, mockCommand, restart, emit, inspect } = await runtime(t, {
    POSTRELAY_CONFIG: JSON.stringify({ feeds: [feed, { ...feed, id: 'second', role_id: '456' }] }),
  });
  await command('start'); await ready();
  await command('start'); await command('start');
  assert.equal((await mockCommand('state')).connections, 1);
  await emit('200');
  await waitFor(() => inspect(), value => value.jobs.length === 2 && value.jobs.every(job => job.state === 'delivered'), 'both feeds should deliver');
  assert.equal((await mockCommand('state')).connections, 1);
  assert.equal((await mockCommand('state')).profileRequests, 1, 'multiple feeds share one public profile lookup');
  await mockCommand('close');
  const status = await waitFor(() => command('status'), value => value.value.last_error === 'push_server_backoff', 'close 4774 should persist a backoff');
  assert.ok(status.value.next_reconnect_at > Date.now() + 29 * 60000);
  await command('start');
  assert.equal((await mockCommand('state')).connections, 1, 'start must not bypass server backoff');
  await restart();
  await command('start');
  assert.equal((await command('status')).value.next_reconnect_at, status.value.next_reconnect_at);
  assert.equal((await mockCommand('state')).connections, 0);
  await command('stop');
});

test('X authentication failure pauses retries; corrected credentials resume the saved subscription', async t => {
  const { command, mockCommand, inspect, ready, restart } = await runtime(t);
  await mockCommand('options', { registrationStatus: 401 });
  await command('start');
  const failed = await waitFor(() => command('status'), value => value.value.source_paused, '401 should pause the source');
  assert.equal(failed.value.last_error, 'x_auth_required');
  assert.equal(failed.value.registered, false);
  await inspect('due');
  assert.equal((await mockCommand('state')).registrations.length, 1);
  await command('stop');
  await restart({ X_AUTH_TOKEN: 'synthetic_renewed_cookie' });
  await command('start'); await ready();
  assert.equal((await mockCommand('state')).registrations.length, 1);
  assert.equal((await command('status')).value.registered, true);
  await command('stop');
});

test('replaced Mozilla identity registers new keys; encrypted state survives reconnect and rejects a wrong key', async t => {
  const { command, ready, mockCommand, inspect, restart } = await runtime(t);
  await command('start'); await ready();
  const first = (await mockCommand('state')).registrations[0];
  await mockCommand('options', { uaid: 'fedcba9876543210fedcba9876543210' });
  await mockCommand('close', { code: 1001 });
  await waitFor(() => command('status'), value => !value.value.connected, 'close should disconnect');
  await inspect('due'); await ready();
  const state = await mockCommand('state');
  assert.equal(state.registrations.length, 2);
  assert.notEqual(state.registrations[1].encryption_key1, first.encryption_key1);
  await command('stop');
  const stored = await inspect();
  await restart({ STORAGE_KEY: Buffer.alloc(32, 22).toString('base64url') });
  const rejected = await command('start');
  assert.equal(rejected.status, 400);
  assert.equal(rejected.value.error, 'storage_key_mismatch');
  assert.deepEqual((await inspect()).metadata, stored.metadata, 'wrong keys must never reset saved state');
  assert.equal((await mockCommand('state')).connections, 0);
});

test('DMs, corrupt pushes and unproven public content never create deliveries', async t => {
  const { command, ready, mockCommand, emit, inspect } = await runtime(t);
  await command('start'); await ready();
  await emit('300', { uri: '/messages/300' });
  await waitFor(() => mockCommand('state'), value => value.acks.length === 1, 'DM should be discarded');
  assert.equal((await mockCommand('state')).embedRequests, 0);
  await mockCommand('push', { data: 'invalid_ciphertext', version: 'corrupt' });
  const corrupt = await waitFor(() => mockCommand('state'), value => value.acks.length === 2, 'corrupt push should be rejected');
  assert.equal(corrupt.acks[1].code, 101);
  await mockCommand('options', { embedBody: { type: 'rich', url: 'https://x.com/other/status/301',
    author_url: 'https://x.com/other', html: '<p>Unconfigured public author</p>' } });
  await emit('301');
  await waitFor(() => inspect(), value => value.posts.some(post => post.id === '301' && post.state === 'ignored'), 'unproven author should be ignored');
  const stored = await inspect();
  assert.equal(stored.jobs.length, 0);
  assert.doesNotMatch(JSON.stringify(stored), /PRIVATE|Unconfigured public/);
  assert.equal((await mockCommand('state')).discordRequests, 0);
  await command('stop');
});

test('stop during lookup prevents new sends; a changed webhook cannot receive an old pending job', async t => {
  const { command, ready, mockCommand, emit, inspect, restart } = await runtime(t);
  await mockCommand('options', { holdEmbed: true });
  await command('start'); await ready();
  await emit('400');
  await waitFor(() => mockCommand('state'), value => value.pendingEmbeds === 1, 'lookup should be in progress');
  await command('stop');
  await mockCommand('release');
  await waitFor(() => inspect(), value => value.jobs.length === 1, 'already-received candidate remains saved');
  assert.equal((await mockCommand('state')).discordRequests, 0);
  await restart({ POSTRELAY_CONFIG: JSON.stringify({ feeds: [{ ...feed, webhook_url: 'https://discord.com/api/webhooks/999/changed' }] }) });
  await command('start');
  const state = await waitFor(() => inspect(), value => value.jobs[0]?.state === 'failed', 'changed destination should require review');
  assert.equal(state.jobs[0].error, 'destination_changed');
  assert.deepEqual((await mockCommand('state')).unexpected, []);
  assert.equal((await mockCommand('state')).discordRequests, 0);
  await command('stop');
});


test('profile outage omits only the icon; verified posts still deliver', async t => {
  const { command, ready, mockCommand, emit, inspect } = await runtime(t);
  await mockCommand('options', { profileStatus: 429 });
  await command('start'); await ready();
  await emit('999');
  const state = await waitFor(() => mockCommand('state'), value => value.messages.length === 1, 'profile outage must not block notification');
  assert.deepEqual(state.messages[0].embeds[0].author, { name: 'Demo Studio (@demo_studio)', url: 'https://x.com/demo_studio' });
  assert.equal((await inspect()).jobs[0].state, 'delivered');
  assert.deepEqual(state.unexpected, []);
  await command('stop');
});

test('stop and start re-registers an existing subscription with renewed X credentials', async t => {
  const { command, ready, mockCommand, restart } = await runtime(t);
  await command('start'); await ready();
  await command('stop');
  await restart({ X_AUTH_TOKEN: 'synthetic_renewed_cookie' });
  await command('start'); await ready();
  assert.equal((await mockCommand('state')).registrations.length, 1, 'resume must renew the X registration');
  await command('stop');
});

function repostNotification(timestamp = Date.now() - 1000) {
  return { globalObjects: { users: {
    '10': { id_str: '10', screen_name: 'demo_studio', protected: false },
    '20': { id_str: '20', screen_name: 'original', protected: false },
  }, tweets: { '100': { id_str: '100', user_id_str: '10', retweeted_status_id_str: '90', full_text: 'PRIVATE API BODY' },
    '90': { id_str: '90', user_id_str: '20', full_text: 'PRIVATE ORIGINAL' } } },
  timeline: { instructions: [{ addEntries: { entries: [{ entryId: 'tweet-100', sortIndex: String(timestamp),
    content: { item: { content: { tweet: { id: '100' } } } } }] } }] } };
}
const originalEmbed = { type: 'rich', url: 'https://x.com/original/status/90', author_url: 'https://x.com/original',
  author_name: 'Original Person', html: '<blockquote><p>Verified original</p>footer</blockquote>' };

test('only a received push triggers repost lookup and persisted deduplication', async t => {
  const { command, ready, mockCommand, inspect, emit } = await runtime(t, {
    POSTRELAY_CONFIG: JSON.stringify({ feeds: [{ ...feed, include_reposts: true }] }),
  });
  await mockCommand('options', { notifications: repostNotification(), embedBody: originalEmbed });
  await command('start'); await ready();
  assert.equal((await mockCommand('state')).notificationRequests, 0);
  await emit('100', { uri: '/i/notifications' });
  const state = await waitFor(() => mockCommand('state'), value => value.messages.length === 1, 'push-triggered public repost must deliver');
  assert.equal(state.messages[0].embeds[0].url, originalEmbed.url);
  assert.match(state.messages[0].embeds[0].footer.text, /@demo_studio.*リポスト/);
  await emit('100', { uri: '/i/notifications', version: 'again' });
  await waitFor(() => mockCommand('state'), value => value.acks.length === 2, 'both pushes should be acknowledged');
  assert.equal((await mockCommand('state')).messages.length, 1);
  const status = (await command('status')).value;
  assert.equal(status.push_received, 2);
  assert.equal(status.last_push_result, 'notification_list');
  assert.doesNotMatch(JSON.stringify(await inspect()), /PRIVATE/);
  await command('stop');
});

test('DM pushes do not trigger timeline reads and diagnostics retain no payload', async t => {
  const { command, ready, mockCommand, inspect, emit } = await runtime(t, {
    POSTRELAY_CONFIG: JSON.stringify({ feeds: [{ ...feed, include_reposts: true }] }),
  });
  await command('start'); await ready();
  await emit('100', { uri: '/messages/123' });
  await waitFor(() => mockCommand('state'), value => value.acks.length === 1, 'private push should be acknowledged');
  assert.equal((await mockCommand('state')).notificationRequests, 0);
  const status = (await command('status')).value;
  assert.equal(status.push_received, 1);
  assert.ok(status.last_push_at > 0);
  assert.doesNotMatch(JSON.stringify(await inspect()), /PRIVATE|messages\/123/);
  await command('stop');
});

test('push-only mode never reads the X timeline on start or recovery alarms', async t => {
  const { command, ready, mockCommand, inspect } = await runtime(t, {
    POSTRELAY_CONFIG: JSON.stringify({ feeds: [{ ...feed, include_reposts: true }] }),
  });
  await command('start'); await ready();
  await inspect('sync-due');
  await command('start'); await inspect('due');
  assert.equal((await mockCommand('state')).notificationRequests, 0);
  await command('stop');
});


test('a push lookup survives a transient error and retries only its durable work', async t => {
  const { command, ready, mockCommand, inspect, emit } = await runtime(t, {
    POSTRELAY_CONFIG: JSON.stringify({ feeds: [{ ...feed, include_reposts: true }] }),
  });
  await mockCommand('options', { notificationStatus: 429 });
  await command('start'); await ready();
  await emit('100', { uri: '/i/notifications' });
  await waitFor(() => command('status'), value => value.value.last_notification_sync_error === 'notification_sync_rate_limit', 'failure should be retained');
  assert.equal((await mockCommand('state')).acks.length, 1);
  await mockCommand('options', { notificationStatus: 200, notifications: repostNotification(), embedBody: originalEmbed });
  await inspect('sync-due');
  await waitFor(() => mockCommand('state'), value => value.messages.length === 1, 'pending lookup must retry without a second push');
  await inspect('sync-due');
  assert.equal((await mockCommand('state')).notificationRequests, 2, 'successful lookup leaves no polling work');
  await command('stop');
});

test('a second push during lookup keeps another durable lookup pending', async t => {
  const { command, ready, mockCommand, inspect, emit } = await runtime(t, {
    POSTRELAY_CONFIG: JSON.stringify({ feeds: [{ ...feed, include_reposts: true }] }),
  });
  await command('start'); await ready();
  await mockCommand('options', { holdNotifications: true });
  await emit('100', { uri: '/i/notifications' });
  await waitFor(() => mockCommand('state'), value => value.notificationRequests === 1, 'first lookup must start');
  await emit('101', { uri: '/i/notifications' });
  await waitFor(() => mockCommand('state'), value => value.acks.length === 2, 'second push must be durable before ACK');
  await mockCommand('options', { holdNotifications: false });
  await mockCommand('release');
  await waitFor(() => command('status'), value => value.value.last_notification_sync_at !== null, 'first lookup must complete');
  await inspect('due');
  await waitFor(() => mockCommand('state'), value => value.notificationRequests === 2, 'later push must cause another lookup');
  await command('stop');
});
