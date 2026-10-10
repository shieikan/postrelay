import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openSocket, readPostNotifications } from '../src/upstream.js';

test('notification lookup is bounded, fixed-origin, read-only and reports sanitized failures', async t => {
  const env = { X_AUTH_TOKEN: 'synthetic_cookie_for_testing', X_CSRF_TOKEN: 'synthetic_csrf_for_testing' };
  let status = 200, huge = false;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://x.com/i/api/2/notifications/device_follow.json?count=20&tweet_mode=extended');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.method, undefined);
    assert.ok(options.signal);
    assert.equal(options.headers.Referer, 'https://x.com/');
    assert.equal(options.headers.Cookie, `auth_token=${env.X_AUTH_TOKEN}; ct0=${env.X_CSRF_TOKEN}`);
    return new Response(huge ? 'x'.repeat(1048577) : JSON.stringify({ error: 'PRIVATE upstream body' }), { status });
  });
  await readPostNotifications(env);
  for (const [s, code] of [[401, 'x_auth_required'], [403, 'x_auth_required'], [429, 'notification_sync_rate_limit'], [302, 'notification_sync_unavailable'], [500, 'notification_sync_unavailable']]) {
    status = s;
    await assert.rejects(readPostNotifications(env), error => error.code === code && !error.message.includes('PRIVATE'));
  }
  status = 200; huge = true;
  await assert.rejects(readPostNotifications(env), /invalid_response/);
});

test('a pending socket handshake still aborts at its deadline', { timeout: 15000 }, async t => {
  let signal;
  t.mock.method(globalThis, 'fetch', (url, options) => {
    assert.equal(url, 'https://push.services.mozilla.com/');
    assert.equal(options.redirect, 'manual');
    signal = options.signal;
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  });
  const result = openSocket().catch(error => error);
  await new Promise(resolve => setTimeout(resolve, 11000));
  assert.equal(signal.aborted, true, 'clearing the successful-handshake timer must not remove the pending-handshake limit');
  const error = await result;
  assert.equal(error.code, 'push_connection_failed');
  assert.equal(error.retryable, true);
});
