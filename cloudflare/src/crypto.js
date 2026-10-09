// Web Push key schedule: RFC 8291/8188 and legacy aesgcm (draft-ietf-webpush-encryption-03).
// Cryptographic primitives are provided by Web Crypto, not implemented here.
import { RelayError } from './core.js';

const utf8 = new TextEncoder();
export function toBase64(bytes) {
  let raw = '';
  for (const byte of new Uint8Array(bytes)) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromBase64(value, max = 65536) {
  if (typeof value !== 'string' || value.length > Math.ceil(max * 4 / 3) + 4 ||
    !/^[A-Za-z0-9_-]+={0,2}$/.test(value) || /\s/.test(value)) throw new Error('invalid_base64');
  const clean = value.replace(/=+$/, '');
  const raw = atob(clean.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - clean.length % 4) % 4));
  const bytes = Uint8Array.from(raw, char => char.charCodeAt(0));
  if (bytes.length > max || toBase64(bytes) !== clean) throw new Error('invalid_base64');
  return bytes;
}
function join(...parts) {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}
async function hkdf(input, salt, info, length) {
  const key = await crypto.subtle.importKey('raw', input, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}
async function sharedSecret(keys, remote) {
  const publicKey = fromBase64(keys.publicKey, 65);
  const privateKey = fromBase64(keys.privateKey, 32);
  if (publicKey.length !== 65 || publicKey[0] !== 4 || privateKey.length !== 32 || remote.length !== 65 || remote[0] !== 4) throw new Error();
  const local = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', ext: true,
    x: toBase64(publicKey.slice(1, 33)), y: toBase64(publicKey.slice(33)), d: toBase64(privateKey) },
  { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const peer = await crypto.subtle.importKey('raw', remote, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, local, 256));
}
export async function generateKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const privateKey = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { publicKey: toBase64(await crypto.subtle.exportKey('raw', pair.publicKey)),
    privateKey: privateKey.d, authSecret: toBase64(crypto.getRandomValues(new Uint8Array(16))) };
}

function headerParameter(value, name) {
  if (typeof value !== 'string' || value.length > 2048 || /[\r\n]/.test(value)) throw new Error();
  const values = value.split(';').map(part => part.trim()).filter(part => part.startsWith(name + '='));
  if (values.length !== 1) throw new Error();
  return values[0].slice(name.length + 1).replace(/^"([A-Za-z0-9_=-]+)"$/, '$1');
}

async function decryptModern(bytes, keys) {
  if (bytes.length < 103 || bytes[20] !== 65) throw new Error();
  const recordSize = new DataView(bytes.buffer, bytes.byteOffset).getUint32(16);
  const encrypted = bytes.slice(86);
  // Web Push requires one final record and rs greater than its ciphertext length.
  if (recordSize <= encrypted.length) throw new Error();
  const remote = bytes.slice(21, 86);
  const shared = await sharedSecret(keys, remote);
  const auth = fromBase64(keys.authSecret, 16);
  if (auth.length !== 16) throw new Error();
  const ikm = await hkdf(shared, auth, join(utf8.encode('WebPush: info\0'), fromBase64(keys.publicKey, 65), remote), 32);
  const salt = bytes.slice(0, 16);
  const key = await hkdf(ikm, salt, utf8.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(ikm, salt, utf8.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aes, encrypted));
  let delimiter = plain.length - 1;
  while (delimiter >= 0 && plain[delimiter] === 0) delimiter--;
  if (delimiter < 0 || plain[delimiter] !== 2) throw new Error();
  return plain.slice(0, delimiter);
}

async function decryptLegacy(bytes, headers, keys) {
  const remote = fromBase64(headerParameter(headers.crypto_key, 'dh'), 65);
  const salt = fromBase64(headerParameter(headers.encryption, 'salt'), 16);
  const auth = fromBase64(keys.authSecret, 16);
  if (salt.length !== 16 || auth.length !== 16) throw new Error();
  let recordSize = 4096;
  if (/(?:^|;)\s*rs=/.test(headers.encryption)) {
    const rs = headerParameter(headers.encryption, 'rs');
    if (!/^[0-9]{1,5}$/.test(rs)) throw new Error();
    recordSize = Number(rs);
  }
  if (recordSize < 3 || recordSize > 65536 || bytes.length < 18 || bytes.length % (recordSize + 16) === 0) throw new Error();
  const shared = await sharedSecret(keys, remote);
  const ikm = await hkdf(shared, auth, utf8.encode('Content-Encoding: auth\0'), 32);
  const context = join(utf8.encode('P-256\0'), new Uint8Array([0, 65]), fromBase64(keys.publicKey, 65), new Uint8Array([0, 65]), remote);
  const key = await hkdf(ikm, salt, join(utf8.encode('Content-Encoding: aesgcm\0'), context), 16);
  const baseNonce = await hkdf(ikm, salt, join(utf8.encode('Content-Encoding: nonce\0'), context), 12);
  const aes = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['decrypt']);
  const chunks = [];
  for (let offset = 0, sequence = 0; offset < bytes.length; offset += recordSize + 16, sequence++) {
    const nonce = baseNonce.slice();
    // The bounded payload cannot exceed 2^32 records.
    for (let i = 0; i < 4; i++) nonce[11 - i] ^= (sequence >>> (8 * i)) & 255;
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aes, bytes.slice(offset, offset + recordSize + 16)));
    if (plain.length < 2) throw new Error();
    const padding = plain[0] * 256 + plain[1];
    if (padding > plain.length - 2 || plain.slice(2, 2 + padding).some(byte => byte !== 0)) throw new Error();
    chunks.push(plain.slice(2 + padding));
  }
  return join(...chunks);
}

export async function decryptPush(data, headers = {}, keys) {
  try {
    const bytes = fromBase64(data);
    const encoding = headers?.encoding ?? 'aes128gcm';
    let plain;
    if (encoding === 'aes128gcm') plain = await decryptModern(bytes, keys);
    else if (encoding === 'aesgcm') plain = await decryptLegacy(bytes, headers, keys);
    else throw new Error();
    return new TextDecoder('utf-8', { fatal: true }).decode(plain);
  } catch { throw new RelayError('invalid_ciphertext'); }
}

async function storageKey(secret, usages) {
  const bytes = fromBase64(secret, 32);
  if (bytes.length !== 32) throw new Error();
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, usages);
}
const aad = utf8.encode('postrelay-cloudflare/subscription/v1');
export async function seal(value, secret) {
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await storageKey(secret, ['encrypt']);
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, utf8.encode(JSON.stringify(value)));
    return { v: 1, iv: toBase64(iv), data: toBase64(data) };
  } catch { throw new RelayError('invalid_storage_key'); }
}
export async function unseal(value, secret) {
  try {
    if (value.v !== 1) throw new Error();
    const iv = fromBase64(value.iv, 12);
    if (iv.length !== 12) throw new Error();
    const key = await storageKey(secret, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, fromBase64(value.data));
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain));
  } catch { throw new RelayError('storage_key_mismatch'); }
}
