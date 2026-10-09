import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, stat, readFile, writeFile, symlink, chmod, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createSettings, saveSettings, loadSettings, secretBindings, validateWorkerOrigin } from '../scripts/settings.js';
import { statusView, errorText } from '../scripts/diagnostics.js';

const inputs = { origin: 'https://postrelay.example.workers.dev', handle: 'demo_studio',
  webhook: 'https://discord.com/api/webhooks/123/synthetic', auth: 'synthetic_auth_cookie', csrf: 'synthetic_csrf_cookie' };
async function directory(t) {
  const root = resolve('../work/cloudflare-setup'); await mkdir(root, { recursive: true });
  const dir = await mkdtemp(root + '/run-');
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('setup creates independent tokens and a protected operator file; never overwrites it', async t => {
  const root = await directory(t);
  const settings = createSettings(inputs);
  const another = createSettings(inputs);
  assert.notEqual(settings.secrets.ADMIN_TOKEN, another.secrets.ADMIN_TOKEN);
  assert.notEqual(settings.secrets.STORAGE_KEY, another.secrets.STORAGE_KEY);
  await saveSettings(root, settings);
  const file = join(root, '.postrelay/settings.json');
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal((await stat(join(root, '.postrelay'))).mode & 0o777, 0o700);
  assert.deepEqual(await loadSettings(root), settings);
  await assert.rejects(() => saveSettings(root, another));
  assert.equal(JSON.parse(await readFile(file, 'utf8')).secrets.STORAGE_KEY, settings.secrets.STORAGE_KEY);
  const bindings = secretBindings(settings);
  assert.equal(JSON.parse(bindings.POSTRELAY_CONFIG).feeds[0].handle, inputs.handle);
  assert.equal(bindings.X_AUTH_TOKEN, inputs.auth);
});

test('control prints only known status fields and error codes', () => {
  const result = statusView({ enabled: true, token: 'PRIVATE_TOKEN', last_error: 'PRIVATE_TOKEN',
    jobs: { failed: 1, PRIVATE_TOKEN: 20 }, post_errors: { public_lookup_failed: 2, PRIVATE_TOKEN: 1 } });
  assert.deepEqual(result, { enabled: true, jobs: { failed: 1 }, post_errors: { public_lookup_failed: 2 } });
  assert.doesNotMatch(errorText('PRIVATE_TOKEN'), /PRIVATE_TOKEN/);
  assert.match(errorText('x_auth_required'), /Cookie/);
});

test('setup and management reject symlinks and world-readable settings', async t => {
  const root = await directory(t);
  await mkdir(join(root, 'outside'), { mode: 0o700 });
  await symlink(join(root, 'outside'), join(root, '.postrelay'));
  await assert.rejects(() => saveSettings(root, createSettings(inputs)));
  await assert.rejects(() => loadSettings(root));
  await rm(join(root, '.postrelay'));
  await saveSettings(root, createSettings(inputs));
  await chmod(join(root, '.postrelay/settings.json'), 0o644);
  await assert.rejects(() => loadSettings(root));
});

test('control destination must be a bare HTTPS workers.dev origin', () => {
  assert.equal(validateWorkerOrigin(inputs.origin), inputs.origin);
  for (const origin of ['http://postrelay.example.workers.dev', 'https://workers.dev.evil.test',
    'https://postrelay.example.workers.dev/api/start', 'https://u:p@postrelay.example.workers.dev',
    'https://postrelay.example.workers.dev:443', 'https://postrelay.example.workers.dev?token=secret']) {
    assert.throws(() => validateWorkerOrigin(origin));
  }
});

test('interactive setup refuses piped secret input without echoing it', () => {
  const result = spawnSync(process.execPath, ['scripts/configure.js'], { input: 'DO_NOT_PRINT_COOKIE', encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout + result.stderr, /DO_NOT_PRINT_COOKIE/);
  assert.match(result.stdout + result.stderr, /端末/);
});

test('interactive setup masks all credentials in a real POSIX terminal', async t => {
  const root = await directory(t);
  const result = spawnSync('python3', ['tests/configure-pty.py', process.execPath,
    resolve('scripts/configure.js'), root], { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal((await loadSettings(root)).config.feeds[0].handle, inputs.handle);
});

test('configuration upload validates the complete UTF-8 byte size, including the advertised twenty-feed case', () => {
  const atLimit = createSettings(inputs);
  const words = atLimit.config.feeds[0].include = Array.from({ length: 50 }, (_, i) => String(i).padEnd(80, 'x'));
  for (let i = 0; i < words.length; i++) {
    const remaining = 5000 - Buffer.byteLength(JSON.stringify(atLimit.config), 'utf8');
    words[i] += 'x'.repeat(Math.min(100 - words[i].length, remaining));
  }
  words[words.length - 1] = words.at(-1).slice(0, -1);
  assert.equal(Buffer.byteLength(secretBindings(atLimit).POSTRELAY_CONFIG, 'utf8'), 4999);
  words[words.length - 1] += 'x';
  assert.equal(Buffer.byteLength(secretBindings(atLimit).POSTRELAY_CONFIG, 'utf8'), 5000);
  words[words.length - 1] += 'x';
  assert.throws(() => secretBindings(atLimit), /config_too_large/);

  const multibyte = createSettings(inputs);
  multibyte.config.feeds[0].include = Array.from({ length: 50 }, (_, i) => String(i) + '界'.repeat(35));
  assert.ok(JSON.stringify(multibyte.config).length < 5000);
  assert.ok(Buffer.byteLength(JSON.stringify(multibyte.config), 'utf8') > 5000);
  assert.throws(() => secretBindings(multibyte), /config_too_large/);

  const twenty = createSettings({ ...inputs, webhook: 'https://discord.com/api/webhooks/1234567890123456789/' + 's'.repeat(68) });
  twenty.config.feeds = Array.from({ length: 20 }, (_, i) => ({ ...twenty.config.feeds[0], id: 'feed' + i }));
  assert.ok(Buffer.byteLength(JSON.stringify(twenty.config), 'utf8') > 5120);
  assert.throws(() => secretBindings(twenty), /config_too_large/);
  assert.match(errorText('config_too_large'), /5,000/);
});

async function controlFixture(t) {
  const root = await directory(t);
  const settings = createSettings(inputs);
  await saveSettings(root, settings);
  const preload = join(root, 'offline-fetch.mjs');
  await writeFile(preload, `globalThis.fetch = async (url, options) => {
    const target = new URL(url);
    if (target.origin !== ${JSON.stringify(inputs.origin)} || !/^\\/api\\/(status|stop|start|retry)$/.test(target.pathname) ||
        options.headers.Authorization !== ${JSON.stringify('Bearer ' + settings.secrets.ADMIN_TOKEN)}) throw new Error('Unexpected synthetic request');
    console.log('OFFLINE_REQUEST ' + target.pathname);
    return Response.json({ enabled: false, connected: false, last_error: '' });
  };`);
  const cli = resolve('scripts/control.js');
  return { root, settings, file: join(root, '.postrelay/settings.json'),
    run: action => spawnSync(process.execPath, ['--import', preload, cli, action], { cwd: root, encoding: 'utf8', timeout: 5000 }) };
}

test('status and stop remain usable with invalid local runtime settings while start and retry still validate them', async t => {
  const { settings, file, run } = await controlFixture(t);
  for (const action of ['status', 'stop']) assert.equal(run(action).status, 0);
  for (const invalid of ['webhook', 'cookie', 'storage-key', 'missing-config']) {
    const value = structuredClone(settings);
    if (invalid === 'webhook') value.config.feeds[0].webhook_url = 'invalid-local-webhook';
    if (invalid === 'cookie') value.secrets.X_AUTH_TOKEN = '';
    if (invalid === 'storage-key') value.secrets.STORAGE_KEY = '';
    if (invalid === 'missing-config') delete value.config;
    await writeFile(file, JSON.stringify(value));
    for (const action of ['status', 'stop']) {
      const result = run(action);
      assert.equal(result.status, 0, `${invalid}: ${result.stderr}`);
      assert.match(result.stdout, new RegExp('OFFLINE_REQUEST /api/' + action));
    }
    for (const action of ['start', 'retry']) {
      const result = run(action);
      assert.equal(result.status, 1);
      assert.doesNotMatch(result.stdout, /OFFLINE_REQUEST/);
      assert.doesNotMatch(result.stdout + result.stderr, /synthetic_auth_cookie|synthetic_csrf_cookie|invalid-local-webhook/);
    }
  }
});

test('management-only commands still reject invalid authority and unsafe local settings before HTTP', async t => {
  for (const invalid of ['admin-token', 'admin-padding', 'origin', 'version', 'json', 'size', 'file-mode', 'directory-mode', 'symlink']) {
    const { root, settings, file, run } = await controlFixture(t);
    if (invalid === 'admin-token') settings.secrets.ADMIN_TOKEN = 'invalid';
    if (invalid === 'admin-padding') settings.secrets.ADMIN_TOKEN = 'A'.repeat(42) + 'B';
    if (invalid === 'origin') settings.origin = 'https://untrusted.example';
    if (invalid === 'version') settings.version = 2;
    if (invalid === 'size') settings.padding = 'x'.repeat(65536);
    await writeFile(file, invalid === 'json' ? '{bad json PRIVATE_INPUT' : JSON.stringify(settings));
    if (invalid === 'file-mode') await chmod(file, 0o644);
    if (invalid === 'directory-mode') await chmod(join(root, '.postrelay'), 0o755);
    if (invalid === 'symlink') {
      const target = join(root, 'outside-settings.json');
      await writeFile(target, JSON.stringify(settings), { mode: 0o600 });
      await rm(file); await symlink(target, file);
    }
    for (const action of ['status', 'stop']) {
      const result = run(action);
      assert.equal(result.status, 1, invalid);
      assert.doesNotMatch(result.stdout, /OFFLINE_REQUEST/);
      assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_INPUT|synthetic_auth_cookie|synthetic_csrf_cookie/);
    }
  }
});
