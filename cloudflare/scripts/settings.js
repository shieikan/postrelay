import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { readConfig } from '../src/core.js';
import { validateCookies } from '../src/upstream.js';

// Cloudflare limits each secret to 5 KB. Use a conservative UTF-8 byte bound.
const MAX_CONFIG_BYTES = 5000;

export function validateWorkerOrigin(value) {
  if (typeof value !== 'string' || value.length > 253 || /\s/.test(value) ||
    !/^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.workers\.dev$/.test(value)) throw new Error('invalid_worker_origin');
  return value;
}

export function createSettings({ origin, handle, webhook, auth, csrf }) {
  const settings = { version: 1, origin: validateWorkerOrigin(origin),
    config: { feeds: [{ id: 'default', handle, webhook_url: webhook, include: [], exclude: [],
      role_id: '', enabled: true, allow_unknown_kind: true }] },
    secrets: { ADMIN_TOKEN: randomBytes(32).toString('base64url'), STORAGE_KEY: randomBytes(32).toString('base64url'),
      X_AUTH_TOKEN: auth, X_CSRF_TOKEN: csrf } };
  secretBindings(settings);
  return settings;
}

function validateToken(token, code) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token) ||
    Buffer.from(token, 'base64url').toString('base64url') !== token) throw new Error(code);
}

function managementSettings(settings) {
  if (!settings || settings.version !== 1 || !settings.secrets) throw new Error('invalid_settings');
  validateWorkerOrigin(settings.origin);
  validateToken(settings.secrets.ADMIN_TOKEN, 'invalid_admin_token');
  return { origin: settings.origin, secrets: { ADMIN_TOKEN: settings.secrets.ADMIN_TOKEN } };
}

export function secretBindings(settings) {
  managementSettings(settings);
  const config = readConfig(JSON.stringify(settings.config));
  validateCookies(settings.secrets);
  const { ADMIN_TOKEN, STORAGE_KEY, X_AUTH_TOKEN, X_CSRF_TOKEN } = settings.secrets;
  validateToken(STORAGE_KEY, 'invalid_storage_key');
  const POSTRELAY_CONFIG = JSON.stringify(config);
  if (Buffer.byteLength(POSTRELAY_CONFIG, 'utf8') > MAX_CONFIG_BYTES) throw new Error('config_too_large');
  return { ADMIN_TOKEN, STORAGE_KEY, X_AUTH_TOKEN, X_CSRF_TOKEN, POSTRELAY_CONFIG };
}

function checkPermissions(info, directory) {
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile()) ||
    (info.mode & 0o077) !== 0 || (typeof process.getuid === 'function' && info.uid !== process.getuid())) throw new Error('unsafe_settings_permissions');
}

async function settingsDirectory(root, create) {
  const directory = join(root, '.postrelay');
  try { checkPermissions(await lstat(directory), true); }
  catch (error) {
    if (error.code !== 'ENOENT' || !create) throw error;
    await mkdir(directory, { mode: 0o700 });
    checkPermissions(await lstat(directory), true);
  }
  return directory;
}

export async function saveSettings(root, settings) {
  secretBindings(settings);
  const directory = await settingsDirectory(root, true);
  const file = await open(join(directory, 'settings.json'), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(JSON.stringify(settings, null, 2) + '\n'); await file.sync(); }
  finally { await file.close(); }
}

async function readSettings(root) {
  const directory = await settingsDirectory(root, false);
  const file = await open(join(directory, 'settings.json'), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat(); checkPermissions(info, false);
    if (info.size > 65536) throw new Error('invalid_settings');
    const text = await file.readFile('utf8');
    if (text.length > 65536) throw new Error('invalid_settings');
    try { return JSON.parse(text); }
    catch { throw new Error('invalid_settings'); }
  } finally { await file.close(); }
}

export async function loadSettings(root) {
  const settings = await readSettings(root);
  secretBindings(settings);
  return settings;
}

export async function loadManagementSettings(root) {
  return managementSettings(await readSettings(root));
}
