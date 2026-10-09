import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openSocket } from '../src/upstream.js';

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
