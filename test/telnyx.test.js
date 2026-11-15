import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { telnyxProvider, verifyTelnyxSignature } from '../src/messaging.js';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const publicKeyB64 = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
const now = new Date('2026-11-04T15:00:00Z');
const ts = String(Math.floor(now.getTime() / 1000));
const rawBody = '{"data":{"event_type":"message.received"}}';
const signature = sign(null, Buffer.from(`${ts}|${rawBody}`), privateKey).toString('base64');

test('Telnyx signature: valid request passes', () => {
  assert.equal(verifyTelnyxSignature({ publicKey: publicKeyB64, signature, timestamp: ts, rawBody, now }), true);
});

test('Telnyx signature: tampered body, stale timestamp, wrong key or missing header fail', () => {
  const base = { publicKey: publicKeyB64, signature, timestamp: ts, rawBody, now };
  assert.equal(verifyTelnyxSignature({ ...base, rawBody: rawBody + ' ' }), false);
  assert.equal(verifyTelnyxSignature({ ...base, now: new Date(now.getTime() + 6 * 60_000) }), false);
  const other = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
  assert.equal(verifyTelnyxSignature({ ...base, publicKey: other }), false);
  assert.equal(verifyTelnyxSignature({ ...base, signature: undefined }), false);
  assert.equal(verifyTelnyxSignature({ ...base, publicKey: 'not-a-key' }), false);
});

test('telnyxProvider posts to the v2 Messages API and returns the message id', async () => {
  let seen;
  const provider = telnyxProvider({
    apiKey: 'KEY', from: '+15555550001', messagingProfileId: 'prof',
    fetchImpl: async (url, init) => { seen = { url, init }; return { ok: true, status: 200, json: async () => ({ data: { id: 'abc' } }) }; },
  });
  assert.deepEqual(await provider.send({ to: '+15555550100', body: 'hi' }), { id: 'abc' });
  assert.equal(seen.url, 'https://api.telnyx.com/v2/messages');
  assert.equal(seen.init.headers.Authorization, 'Bearer KEY');
  assert.deepEqual(JSON.parse(seen.init.body), { from: '+15555550001', to: '+15555550100', text: 'hi', messaging_profile_id: 'prof' });
});

test('telnyxProvider throws on an API error', async () => {
  const provider = telnyxProvider({ apiKey: 'K', from: '+1', fetchImpl: async () => ({ ok: false, status: 422, json: async () => ({ errors: [{ detail: 'bad number' }] }) }) });
  await assert.rejects(provider.send({ to: 'x', body: 'y' }), /bad number/);
});
