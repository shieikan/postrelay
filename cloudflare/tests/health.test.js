import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HEALTH_TIMING } from '../src/health.js';
import { runtime, waitFor } from './runtime-harness.js';

const alertWebhook = 'https://discord.com/api/webhooks/456/synthetic-alert';
const hour = 60 * 60 * 1000;
const metadata = (app, values) => app.inspect('store', Object.entries(values).map(([key, value]) =>
  ({ operation: 'setMeta', args: [key, value] })));
const tick = app => app.inspect('health-tick');
async function start(t, bindings = {}) {
  const app = await runtime(t, bindings);
  await app.command('start');
  await app.ready();
  return app;
}
async function silence(app, age = HEALTH_TIMING.silenceAlert) {
  await metadata(app, { monitoring_started_at: Date.now() - age - 1000, last_push_at: null });
}

test('24h renewal runs once on the same socket, endpoint and keys, and persists across restart', { timeout: 15000 }, async t => {
  const app = await start(t);
  const original = (await app.mockCommand('state')).registrations[0];
  await metadata(app, { last_x_registration_at: Date.now() - HEALTH_TIMING.registration + hour,
    last_push_at: Date.now() });
  await tick(app);
  assert.equal((await app.mockCommand('state')).registrations.length, 1);
  await metadata(app, { last_x_registration_at: Date.now() - HEALTH_TIMING.registration - 1 });
  await Promise.all([tick(app), tick(app)]);
  const state = await app.mockCommand('state');
  assert.deepEqual(state.registrations, [original, original]);
  assert.equal(state.connections, 1);
  assert.equal(state.subscriptions, 1);
  const registeredAt = (await app.command('status')).value.last_x_registration_at;
  assert.ok(registeredAt > Date.now() - 10000);
  await app.restart();
  await tick(app); await app.ready(); await tick(app);
  assert.equal((await app.command('status')).value.last_x_registration_at, registeredAt);
  assert.equal((await app.mockCommand('state')).registrations.length, 0);
  await app.command('stop');
});

test('6h silence renewal is rate-limited even before the first push and after transient failure', { timeout: 15000 }, async t => {
  const app = await start(t);
  await silence(app, HEALTH_TIMING.silentRenewal);
  const old = Date.now() - HEALTH_TIMING.silentRenewal - 1000;
  await metadata(app, { last_x_registration_at: old, last_x_registration_attempt_at: old });
  await tick(app); await tick(app);
  assert.equal((await app.mockCommand('state')).registrations.length, 2);
  await app.mockCommand('options', { registrationStatus: 503 });
  await metadata(app, { last_x_registration_at: old, last_x_registration_attempt_at: old });
  await tick(app);
  const status = await tick(app);
  assert.equal(status.last_x_registration_error, 'x_registration_unavailable');
  assert.equal(status.connected, true);
  assert.equal((await app.mockCommand('state')).registrations.length, 3);
  await app.mockCommand('options', { registrationStatus: 200 });
  await metadata(app, { next_x_registration_at: 0, last_x_registration_attempt_at: old });
  await tick(app); await tick(app);
  assert.equal((await app.mockCommand('state')).registrations.length, 4);
  assert.equal((await app.command('status')).value.last_x_registration_error, '');
  await app.command('stop');
});

test('periodic transient failures retry on a later tick without reconnecting', { timeout: 15000 }, async t => {
  const app = await start(t);
  await metadata(app, { last_x_registration_at: Date.now() - HEALTH_TIMING.registration - 1 });
  await app.mockCommand('options', { registrationStatus: 503 });
  await tick(app); await tick(app);
  assert.equal((await app.mockCommand('state')).registrations.length, 2);
  await app.mockCommand('options', { registrationStatus: 200 });
  await metadata(app, { next_x_registration_at: 0 });
  const status = await tick(app);
  assert.equal(status.last_error, '');
  assert.equal(status.connected, true);
  assert.equal((await app.mockCommand('state')).connections, 1);
  assert.equal((await app.mockCommand('state')).registrations.length, 3);
  await app.command('stop');
});

test('renewal auth failure pauses across ticks and restart; explicit start allows recovery', { timeout: 15000 }, async t => {
  const app = await start(t, { ALERT_WEBHOOK_URL: alertWebhook });
  await metadata(app, { last_x_registration_at: Date.now() - HEALTH_TIMING.registration - 1 });
  await app.mockCommand('options', { registrationStatus: 401 });
  const failed = await tick(app);
  assert.equal(failed.last_error, 'x_auth_required');
  assert.equal(failed.source_paused, true);
  assert.equal(failed.connected, true);
  await metadata(app, { next_x_registration_at: 0 });
  await tick(app); await tick(app);
  let state = await app.mockCommand('state');
  assert.equal(state.registrations.length, 2);
  assert.equal(state.connections, 1);
  assert.equal(state.alerts.length, 1);
  assert.equal(failed.alert_state.source.active, true);
  await app.restart();
  await tick(app); await tick(app);
  state = await app.mockCommand('state');
  assert.equal(state.registrations.length, 0);
  assert.equal(state.connections, 0);
  assert.equal(state.alerts.length, 0);
  await app.command('start'); await app.ready(); await tick(app);
  assert.equal((await app.command('status')).value.source_paused, false);
  assert.equal((await app.mockCommand('state')).registrations.length, 1);
  assert.equal((await app.mockCommand('state')).alerts.length, 1);
  assert.match((await app.mockCommand('state')).alerts[0].content, /復旧/);
  await app.command('stop');
});

test('silence alert survives restart, fires once and recovers once on an empty push', { timeout: 15000 }, async t => {
  const app = await start(t, { ALERT_WEBHOOK_URL: alertWebhook });
  await silence(app, HEALTH_TIMING.silenceAlert - hour);
  await tick(app);
  assert.equal((await app.mockCommand('state')).alerts.length, 0);
  await silence(app);
  await tick(app); await tick(app);
  let state = await app.mockCommand('state');
  assert.equal(state.alerts.length, 1);
  assert.match(state.alerts[0].content, /24時間/);
  assert.deepEqual(state.alerts[0].allowed_mentions, { parse: [] });
  assert.doesNotMatch(JSON.stringify(state.alerts), /synthetic|https:|Cookie|token|PRIVATE/);
  await app.restart();
  await tick(app); await app.ready(); await tick(app);
  assert.equal((await app.mockCommand('state')).alerts.length, 0);
  await app.mockCommand('push', { version: 'empty-health-push' });
  await waitFor(() => app.command('status'), result => result.value.last_push_at !== null, 'empty push should update health');
  await tick(app); await tick(app);
  state = await app.mockCommand('state');
  assert.equal(state.alerts.length, 1);
  assert.match(state.alerts[0].content, /復旧/);
  assert.equal((await app.command('status')).value.alert_state.silence.active, false);
  await app.command('stop');
});

test('failed jobs alert once and recover after retry succeeds', { timeout: 15000 }, async t => {
  const app = await start(t, { ALERT_WEBHOOK_URL: alertWebhook });
  await app.mockCommand('options', { discordStatus: 400 });
  await app.emit('808');
  await waitFor(() => app.command('status'), result => result.value.jobs.failed === 1, 'job should fail');
  await tick(app); await tick(app);
  assert.equal((await app.mockCommand('state')).alerts.length, 1);
  assert.equal((await app.command('status')).value.alert_state.jobs.active, true);
  await app.mockCommand('options', { discordStatus: 200 });
  await app.command('retry');
  await waitFor(() => app.command('status'), result => result.value.jobs.delivered === 1, 'retry should deliver');
  await tick(app); await tick(app);
  const state = await app.mockCommand('state');
  assert.equal(state.alerts.length, 2);
  assert.match(state.alerts[1].content, /復旧/);
  assert.doesNotMatch(JSON.stringify(state.alerts), /Public post|808|synthetic|https:/);
  await app.command('stop');
});

test('configuration failure alerts even when load disables the source, and recovers after correction', { timeout: 15000 }, async t => {
  const app = await start(t, { ALERT_WEBHOOK_URL: alertWebhook });
  await app.restart({ X_AUTH_TOKEN: '' });
  const failed = await tick(app);
  assert.equal(failed.enabled, false);
  assert.equal(failed.last_error, 'invalid_x_credentials');
  assert.equal((await app.mockCommand('state')).alerts.length, 1);
  await app.restart({ X_AUTH_TOKEN: 'synthetic_cookie_for_testing' });
  await app.command('start'); await app.ready(); await tick(app);
  assert.equal((await app.mockCommand('state')).alerts.length, 1);
  assert.match((await app.mockCommand('state')).alerts[0].content, /復旧/);
  await app.command('stop');
});

test('alert failures back off without affecting the source; invalid URL never reaches the network', { timeout: 15000 }, async t => {
  const app = await start(t, { ALERT_WEBHOOK_URL: alertWebhook });
  await silence(app);
  await app.mockCommand('options', { alertStatus: 503 });
  let status = await tick(app);
  assert.equal(status.last_alert_error, 'health_alert_failed');
  assert.deepEqual(status.alert_state, {});
  await tick(app);
  assert.equal((await app.mockCommand('state')).alertRequests, 1);
  await app.mockCommand('options', { alertStatus: 0 });
  await metadata(app, { next_health_alert_at: 0 });
  status = await tick(app);
  assert.equal(status.last_alert_error, '');
  assert.equal(status.alert_state.silence.active, true);
  await app.restart({ ALERT_WEBHOOK_URL: 'https://example.com/private-webhook' });
  await tick(app); await app.ready();
  await metadata(app, { alert_state: {} });
  status = await tick(app);
  assert.equal(status.last_alert_error, 'invalid_webhook');
  assert.equal(status.connected, true);
  assert.deepEqual((await app.mockCommand('state')).unexpected, []);
  await app.command('stop');
});

test('unset alert secret makes all health conditions silent and legacy registration metadata renews safely', { timeout: 15000 }, async t => {
  const app = await start(t);
  await metadata(app, { last_x_registration_at: null, last_x_registration_attempt_at: null });
  await tick(app); await tick(app);
  assert.equal((await app.mockCommand('state')).registrations.length, 2);
  await silence(app);
  await metadata(app, { last_error: 'x_auth_required', source_paused: true });
  await app.mockCommand('options', { discordStatus: 400 });
  await app.emit('809');
  await waitFor(() => app.command('status'), result => result.value.jobs.failed === 1, 'job should fail');
  await tick(app); await tick(app);
  const state = await app.mockCommand('state');
  assert.equal(state.alertRequests, 0);
  assert.deepEqual(state.unexpected, []);
  assert.deepEqual((await app.command('status')).value.alert_state, {});
  await app.command('stop');
});
