import assert from 'node:assert/strict';
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createECDH, randomBytes } from 'node:crypto';
import ece from 'http_ece';

export const feed = { id: 'demo', handle: 'demo_studio', webhook_url: 'https://discord.com/api/webhooks/123/synthetic',
  enabled: true, allow_unknown_kind: true, include: [], exclude: [], role_id: '' };
async function bundle(entry) {
  const result = await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'browser',
    external: ['cloudflare:workers'], write: false, logLevel: 'silent' });
  return result.outputFiles[0].text;
}
const scripts = Promise.all([bundle('tests/runtime-entry.js'), bundle('tests/mock-upstream.js')]);

export async function waitFor(operation, predicate, message) {
  const end = Date.now() + 6000;
  while (Date.now() < end) {
    const value = await operation();
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  assert.fail(message);
}

export async function runtime(t, bindings = {}) {
  const root = resolve('../work/cloudflare-runtime');
  await mkdir(root, { recursive: true });
  const persist = await mkdtemp(root + '/run-');
  const [script, mock] = await scripts;
  let secrets = { POSTRELAY_CONFIG: JSON.stringify({ feeds: [feed] }), ADMIN_TOKEN: 'a'.repeat(43),
    STORAGE_KEY: randomBytes(32).toString('base64url'), X_AUTH_TOKEN: 'synthetic_cookie_for_testing',
    X_CSRF_TOKEN: 'synthetic_csrf_for_testing', ...bindings };
  let mf, upstream;
  const launch = async () => {
    mf = new Miniflare({ ...convertV4MiniflareOptions({ log: new Log(LogLevel.ERROR),
      workers: [{ name: 'relay', modules: true, script, compatibilityDate: '2026-10-06', bindings: secrets,
        durableObjects: { RELAY: { className: 'TestRelay', useSQLite: true } }, outboundService: 'upstream' },
      { name: 'upstream', modules: true, script: mock, compatibilityDate: '2026-10-06',
        durableObjects: { MOCK: { className: 'Mock', useSQLite: true } } }] }),
      resourcePersistencePath: persist, telemetry: { enabled: false }, cf: false });
    upstream = await mf.getWorker('upstream');
  };
  t.after(async () => { await mf?.dispose(); await rm(persist, { recursive: true, force: true }); });
  await launch();
  const command = async (action, authorized = true, method = action === 'status' ? 'GET' : 'POST') => {
    const response = await mf.dispatchFetch('https://relay.example/api/' + action, { method,
      headers: authorized ? { Authorization: 'Bearer ' + secrets.ADMIN_TOKEN } : {} });
    return { status: response.status, value: await response.json() };
  };
  const mockCommand = async (action, body) => {
    const response = await upstream.fetch('https://mock.test/' + action, { method: body ? 'POST' : 'GET',
      body: body ? JSON.stringify(body) : undefined });
    return response.json();
  };
  const inspect = async (action = 'inspect', body) => {
    const ns = await mf.getDurableObjectNamespace('RELAY', 'relay');
    return (await ns.get(ns.idFromName('postrelay')).fetch('https://internal.test/__test/' + action,
      { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined })).json();
  };
  const emit = async (postId, { body = 'PRIVATE NOTIFICATION', version = postId, uri, registration } = {}) => {
    registration ??= (await mockCommand('state')).registrations.at(-1);
    const sender = createECDH('prime256v1'); sender.generateKeys();
    const payload = Buffer.from(JSON.stringify({ body, title: 'PRIVATE USER NAME', data: { uri: uri ?? '/demo_studio/status/' + postId } }));
    const bytes = ece.encrypt(payload, { version: 'aes128gcm', privateKey: sender, salt: randomBytes(16),
      dh: Buffer.from(registration.encryption_key1, 'base64url'), authSecret: Buffer.from(registration.encryption_key2, 'base64url') });
    await mockCommand('push', { data: bytes.toString('base64url'), version });
  };
  return { command, mockCommand, inspect, emit,
    fetch: (path, options) => mf.dispatchFetch('https://relay.example' + path, options),
    restart: async (changes = {}) => { await mf.dispose(); secrets = { ...secrets, ...changes }; await launch(); },
    ready: () => waitFor(() => command('status'), value => value.value.connected, 'source should connect'),
  };
}
