// AutoPush/X registration compatibility port from sh1ma/Angelic-Angel
// 169a098e2025cc6e41a50fc8d521c483e21d9b6d. See ../NOTICE.
import { RelayError, readBoundedJson } from './core.js';

export const AUTOPUSH_URL = 'https://push.services.mozilla.com/';
export const X_REGISTER_URL = 'https://x.com/i/api/1.1/notifications/settings/login.json';
// Public web-client identifier shipped by X, not an operator's credential.
const X_PUBLIC_BEARER = 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
export const X_VAPID_KEY = 'BF5oEo0xDUpgylKDTlsd8pZmxQA1leYINiY-rSscWYK_3tWAkz4VMbtf1MLE_Yyd6iII6o-e3Q9TCN5vZMzVMEs'; // gitleaks:allow -- public X VAPID key from pinned upstream

export function validateCookies(env) {
  for (const name of ['X_AUTH_TOKEN', 'X_CSRF_TOKEN']) {
    if (typeof env[name] !== 'string' || !/^[a-zA-Z0-9_-]{16,2048}$/.test(env[name]) || /\s/.test(env[name])) throw new RelayError('invalid_x_credentials');
  }
}

export async function openSocket() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(AUTOPUSH_URL, { redirect: 'manual', signal: controller.signal,
      headers: { Upgrade: 'websocket', Origin: 'https://x.com', 'User-Agent': 'PostRelay/0.1' } });
    if (response.status !== 101 || !response.webSocket) {
      await response.body?.cancel();
      throw new Error();
    }
    response.webSocket.accept();
    return response.webSocket;
  } catch { throw new RelayError('push_connection_failed', true); }
  finally {
    // An aborted upgrade request also closes its WebSocket. Bound only the handshake.
    clearTimeout(timeout);
  }
}

export function validateEndpoint(value) {
  if (typeof value !== 'string' || value.length > 2048 ||
    !/^https:\/\/updates\.push\.services\.mozilla\.com\/wpush\/v[12]\/[A-Za-z0-9_-]+$/.test(value) || /\s/.test(value)) throw new RelayError('invalid_push_endpoint');
  return value;
}

export async function registerX(session, env) {
  validateCookies(env);
  validateEndpoint(session.endpoint);
  try {
    const response = await fetch(X_REGISTER_URL, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000),
      headers: { Authorization: X_PUBLIC_BEARER, 'x-csrf-token': env.X_CSRF_TOKEN, 'x-twitter-auth-type': 'OAuth2Session',
        'x-twitter-active-user': 'yes', 'x-twitter-client-language': 'en', 'Content-Type': 'application/json',
        Cookie: `auth_token=${env.X_AUTH_TOKEN}; ct0=${env.X_CSRF_TOKEN}` },
      body: JSON.stringify({ push_device_info: { os_version: 'Mac/Firefox', udid: 'Mac/Firefox', env: 3,
        locale: 'en', protocol_version: 1, token: session.endpoint,
        encryption_key1: session.keys.publicKey, encryption_key2: session.keys.authSecret } }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403) throw new RelayError('x_auth_required');
      if (response.status === 429 || response.status >= 500) throw new RelayError('x_registration_unavailable', true);
      throw new RelayError('x_registration_rejected');
    }
    const value = await readBoundedJson(response);
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.errors || value.error) throw new RelayError('x_registration_rejected');
  } catch (error) {
    if (error instanceof RelayError) throw error;
    throw new RelayError('x_registration_unavailable', true);
  }
}
