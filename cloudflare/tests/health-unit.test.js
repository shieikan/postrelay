import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { HEALTH_TIMING } from '../src/health.js';

// Exercise the production tick without workerd's local listening socket.
const bundle = await build({ entryPoints: ['src/worker.js'], bundle: true, write: false, format: 'esm',
  plugins: [{ name: 'durable-object-base', setup(build) {
    build.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'base', namespace: 'test' }));
    build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export class DurableObject {}' }));
  } }] });
const { Relay } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));

function fixture(t, alert = true) {
  const meta = new Map([['enabled', true], ['monitoring_started_at', Date.now()], ['last_cleanup_at', Date.now()],
    ['last_x_registration_at', Date.now()], ['last_x_registration_attempt_at', Date.now()]]);
  const state = { registrations: [], alerts: [], registrationStatus: 200, alertStatus: 200, failedJobs: false };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === 'https://x.com/i/api/1.1/notifications/settings/login.json') {
      state.registrations.push(JSON.parse(options.body));
      if (state.holdRegistration) await state.holdRegistration;
      return Response.json({}, { status: state.registrationStatus });
    }
    assert.equal(url, 'https://discord.com/api/webhooks/456/synthetic-alert?wait=true');
    state.alerts.push(JSON.parse(options.body));
    return new Response(null, { status: state.alertStatus });
  });
  const relay = Object.assign(Object.create(Relay.prototype), {
    env: { ADMIN_TOKEN: 'a'.repeat(43), X_AUTH_TOKEN: 'synthetic_cookie_for_testing', X_CSRF_TOKEN: 'synthetic_csrf_for_testing',
      ALERT_WEBHOOK_URL: alert ? 'https://discord.com/api/webhooks/456/synthetic-alert' : '' },
    store: { meta: (key, fallback = null) => meta.has(key) ? meta.get(key) : fallback,
      setMeta: (key, value) => meta.set(key, structuredClone(value)), hasFailedJobs: () => state.failedJobs,
      nextDue: () => null, counts: () => ({}), errors: () => ({}) },
    ctx: { blockConcurrencyWhile: operation => operation(), waitUntil: operation => { state.pending = operation; },
      storage: { setAlarm: async () => {}, getAlarm: async () => null, deleteAlarm: async () => {} } },
    session: { endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/synthetic',
      keys: { publicKey: 'synthetic-public-key', authSecret: 'synthetic-auth-key' } },
    socket: { close: () => assert.fail('renewal must not close the socket'), send: () => {} },
    phase: 'ready', generation: 1, lastMessageAt: Date.now(), deadline: null,
    load: async () => {}, drain: async () => {}, syncNotifications: async () => {},
  });
  return { relay, meta, state };
}

test('tick renews at 24h once, retaining the session/socket and persisting success', async t => {
  const { relay, meta, state } = fixture(t);
  const session = relay.session, socket = relay.socket;
  meta.set('last_push_at', Date.now());
  meta.set('last_x_registration_at', Date.now() - HEALTH_TIMING.registration + 60000);
  await relay.tick();
  assert.equal(state.registrations.length, 0);
  meta.set('last_x_registration_at', Date.now() - HEALTH_TIMING.registration - 1);
  await Promise.all([relay.tick(), relay.tick()]);
  await relay.tick();
  assert.equal(state.registrations.length, 1);
  assert.equal(relay.session, session);
  assert.equal(relay.socket, socket);
  assert.equal(state.registrations[0].push_device_info.token, session.endpoint);
  assert.equal(state.registrations[0].push_device_info.encryption_key1, session.keys.publicKey);
  assert.ok(meta.get('last_x_registration_at') > Date.now() - 1000);
  assert.equal(relay.phase, 'ready');
});

test('silent renewal attempts stay six hours apart, including failed attempts', async t => {
  const { relay, meta, state } = fixture(t);
  const old = Date.now() - HEALTH_TIMING.silentRenewal - 1;
  for (const key of ['monitoring_started_at', 'last_x_registration_at', 'last_x_registration_attempt_at']) meta.set(key, old);
  state.registrationStatus = 503;
  await relay.tick(); await relay.tick();
  assert.equal(state.registrations.length, 1);
  assert.equal(meta.get('last_x_registration_at'), old);
  assert.equal(meta.get('last_error'), 'x_registration_unavailable');
  assert.ok(meta.get('next_x_registration_at') >= old + 2 * HEALTH_TIMING.silentRenewal);
  state.registrationStatus = 200;
  meta.set('next_x_registration_at', 0);
  meta.set('last_x_registration_attempt_at', old);
  await relay.tick(); await relay.tick();
  assert.equal(state.registrations.length, 2);
  assert.equal(meta.get('last_error'), '');
});

test('periodic transient failure backs off; auth failure pauses and stays paused after socket failure', async t => {
  const { relay, meta, state } = fixture(t);
  meta.set('last_x_registration_at', Date.now() - HEALTH_TIMING.registration - 1);
  state.registrationStatus = 503;
  await relay.tick(); await relay.tick();
  assert.equal(state.registrations.length, 1);
  state.registrationStatus = 403;
  meta.set('next_x_registration_at', 0);
  await relay.tick();
  assert.equal(meta.get('source_paused'), true);
  assert.equal(meta.get('last_error'), 'x_auth_required');
  meta.set('next_x_registration_at', 0);
  await relay.tick(); await relay.tick();
  assert.equal(state.registrations.length, 2);
  assert.equal(state.alerts.length, 1);
  relay.socket = { close() {} };
  await relay.connectionFailed('push_disconnected', true);
  assert.equal(meta.get('source_paused'), true);
  await relay.tick();
  assert.equal(state.registrations.length, 2);
});

test('an early failure cannot delay the 24h renewal deadline', async t => {
  const { relay, meta, state } = fixture(t);
  const last = Date.now() - HEALTH_TIMING.registration + 60 * 60 * 1000;
  meta.set('last_x_registration_at', last);
  meta.set('monitoring_started_at', last);
  meta.set('last_x_registration_attempt_at', last);
  state.registrationStatus = 503;
  await relay.tick();
  assert.equal(state.registrations.length, 1);
  assert.equal(meta.get('next_x_registration_at'), last + HEALTH_TIMING.registration);
});

test('each alert condition sends once and recovers once; saved state suppresses replay', async t => {
  const { relay, meta, state } = fixture(t);
  meta.set('monitoring_started_at', Date.now() - HEALTH_TIMING.silenceAlert - 1);
  meta.set('source_paused', true);
  meta.set('last_error', 'x_auth_required');
  state.failedJobs = true;
  await relay.tick(); await relay.tick();
  assert.equal(state.alerts.length, 3);
  relay.alerting = false;
  meta.set('alert_state', JSON.parse(JSON.stringify(meta.get('alert_state'))));
  await relay.tick();
  assert.equal(state.alerts.length, 3);
  meta.set('last_push_at', Date.now());
  meta.set('source_paused', false);
  meta.set('last_error', '');
  state.failedJobs = false;
  await relay.tick(); await relay.tick();
  assert.equal(state.alerts.length, 6);
  assert.ok(state.alerts.slice(3).every(message => message.content.includes('復旧')));
  assert.doesNotMatch(JSON.stringify(state.alerts), /synthetic|https:|token|Cookie/);
  assert.ok(Object.values(meta.get('alert_state')).every(value => !value.active));
});

test('explicit start retries a paused early renewal immediately and sends recovery after success', async t => {
  const { relay, meta, state } = fixture(t);
  const old = Date.now() - HEALTH_TIMING.silentRenewal - 1;
  for (const key of ['monitoring_started_at', 'last_x_registration_at', 'last_x_registration_attempt_at']) meta.set(key, old);
  state.registrationStatus = 401;
  await relay.tick();
  assert.equal(state.registrations.length, 1);
  assert.equal(state.alerts.length, 1);
  state.registrationStatus = 200;
  const response = await relay.fetch(new Request('https://relay.example/api/start', {
    method: 'POST', headers: { Authorization: 'Bearer ' + relay.env.ADMIN_TOKEN },
  }));
  assert.equal(response.status, 202);
  await state.pending;
  await relay.tick();
  assert.equal(state.registrations.length, 2);
  assert.equal(meta.get('source_paused'), false);
  assert.equal(meta.get('last_x_registration_error'), '');
  assert.equal(state.alerts.length, 2);
  assert.match(state.alerts[1].content, /復旧/);
});

test('invalid configuration sends its warning even when the tick disables the source', async t => {
  const { relay, meta, state } = fixture(t);
  relay.load = Relay.prototype.load;
  relay.env.POSTRELAY_CONFIG = '{}';
  relay.socket = { close() {} };
  await relay.tick(); await relay.tick();
  assert.equal(meta.get('enabled'), false);
  assert.equal(meta.get('last_error'), 'invalid_config');
  assert.equal(state.alerts.length, 1);
  assert.equal(meta.get('alert_state').source.active, true);
});

test('unset or invalid webhook never sends alerts; delivery failure preserves pending transition', async t => {
  const { relay, meta, state } = fixture(t, false);
  meta.set('source_paused', true);
  state.failedJobs = true;
  meta.set('monitoring_started_at', Date.now() - HEALTH_TIMING.silenceAlert - 1);
  await relay.tick();
  assert.equal(state.alerts.length, 0);
  relay.env.ALERT_WEBHOOK_URL = 'https://example.com/private';
  await relay.tick();
  assert.equal(state.alerts.length, 0);
  assert.equal(meta.get('last_alert_error'), 'invalid_webhook');
  relay.env.ALERT_WEBHOOK_URL = 'https://discord.com/api/webhooks/456/synthetic-alert';
  state.alertStatus = 503;
  meta.set('next_health_alert_at', 0);
  await relay.tick(); await relay.tick();
  assert.equal(state.alerts.length, 1);
  assert.equal(meta.has('alert_state'), false);
  state.alertStatus = 204;
  meta.set('next_health_alert_at', 0);
  await relay.tick();
  assert.equal(state.alerts.length, 4);
  assert.equal(meta.get('last_alert_error'), '');
});

test('an in-flight renewal cannot update state after stop; missing registration time renews once', async t => {
  const { relay, meta, state } = fixture(t);
  meta.delete('last_x_registration_at');
  let release;
  state.holdRegistration = new Promise(resolve => { release = resolve; });
  const pending = relay.renewRegistration();
  meta.set('enabled', false);
  relay.generation++;
  release();
  await pending;
  assert.equal(meta.has('last_x_registration_at'), false);
  meta.set('enabled', true);
  meta.set('next_x_registration_at', 0);
  await relay.tick(); await relay.tick();
  assert.equal(state.registrations.length, 2);
  assert.ok(meta.get('last_x_registration_at'));
});
