import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createECDH, randomBytes } from 'node:crypto';
import ece from 'http_ece';
import { generateKeys, decryptPush, seal, unseal } from '../src/crypto.js';

// Public interoperability vector from RFC 8291 section 5; these are not live keys.
const rfc = {
  publicKey: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  privateKey: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94', authSecret: 'BTBZMqHH6r4Tts7J_aSIgg', // gitleaks:allow -- RFC 8291 Appendix A public test vector
};
const ciphertext = 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml' +
  'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT' +
  'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN';

test('RFC 8291 published ciphertext decrypts to the specified plaintext', async () => {
  assert.equal(await decryptPush(ciphertext, { encoding: 'aes128gcm' }, rfc), 'When I grow up, I want to be a watermelon');
});

test('both Web Push encodings interoperate with an independent ECE implementation', async () => {
  const keys = await generateKeys();
  for (const version of ['aes128gcm', 'aesgcm']) {
    const sender = createECDH('prime256v1'); sender.generateKeys();
    const salt = randomBytes(16);
    const payload = Buffer.from(JSON.stringify({ body: 'PRIVATE', data: { url: '/demo_studio/status/123' } }));
    const encrypted = ece.encrypt(payload, { version, privateKey: sender, salt,
      dh: Buffer.from(keys.publicKey, 'base64url'), authSecret: Buffer.from(keys.authSecret, 'base64url') });
    const headers = version === 'aesgcm' ? { encoding: version,
      crypto_key: `dh=${sender.getPublicKey().toString('base64url')}`, encryption: `salt=${salt.toString('base64url')};rs=4096` } : { encoding: version };
    assert.equal(await decryptPush(encrypted.toString('base64url'), headers, keys), payload.toString());
    encrypted[encrypted.length - 1] ^= 1;
    await assert.rejects(() => decryptPush(encrypted.toString('base64url'), headers, keys), /invalid_ciphertext/);
  }
});

test('malformed, oversized and unsupported ciphertext fails closed without echoing input', async () => {
  for (const [data, headers] of [['SECRET!', {}], ['a'.repeat(90000), {}], [ciphertext, { encoding: 'unknown' }],
    [ciphertext, { encoding: 'aesgcm' }]]) {
    await assert.rejects(() => decryptPush(data, headers, rfc), error => error.message === 'invalid_ciphertext');
  }
  const altered = Buffer.from(ciphertext, 'base64url'); altered[20] = 64;
  await assert.rejects(() => decryptPush(altered.toString('base64url'), {}, rfc));
});

test('subscription state is authenticated and encrypted; wrong keys cannot silently reset it', async () => {
  const key = randomBytes(32).toString('base64url');
  const value = { privateKey: 'private subscription material', uaid: 'test-user-agent' };
  const stored = await seal(value, key);
  assert.doesNotMatch(JSON.stringify(stored), /private subscription material|test-user-agent/);
  assert.deepEqual(await unseal(stored, key), value);
  assert.notDeepEqual(await seal(value, key), stored);
  await assert.rejects(() => unseal(stored, randomBytes(32).toString('base64url')), /storage_key_mismatch/);
});
