// Email bounce flagging (SPEC 5.4b B).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb, makeEnv, seedWorld, PASSWORD } from './helpers.js';
import { createApp } from '../src/app.js';
import { flagBounce, isHardRejection, parseBounceEvents, withBounceFlagging } from '../src/bounce.js';

let db, env, world, server, base;
const SECRET = 'x'.repeat(40);
const HOOK = 'hook-secret-123';

before(async () => {
  db = await makeDb();
  env = makeEnv(db, '2026-11-04T15:00:00Z'); // Wednesday 10am EST
  world = await seedWorld(db);
  const app = createApp({ db, messenger: env.messenger, now: env.now, config: { sessionSecret: SECRET, production: false, emailWebhookSecret: HOOK } });
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
beforeEach(async () => {
  await db.query(`UPDATE contact SET email = 'Mrs@Example.test', email_bounced_at = NULL, email_bounce_reason = NULL WHERE id = $1`, [world.contact.id]);
});

const contact = async () => (await db.query('SELECT * FROM contact WHERE id = $1', [world.contact.id])).rows[0];
const hook = (body, qs = `?token=${HOOK}`, headers = {}) =>
  fetch(`${base}/webhooks/email/bounce${qs}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('a hard bounce flags the contact (case-insensitive address) and is logged', async () => {
  const res = await hook({ email: 'mrs@example.test', type: 'hard', reason: 'mailbox does not exist' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).flagged, 1);
  const c = await contact();
  assert.ok(c.email_bounced_at);
  assert.equal(c.email_bounce_reason, 'mailbox does not exist');
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM message_log WHERE status = 'bounced'`)).rows[0].n, 1);
});

test('a soft bounce is logged but does not flag the contact', async () => {
  await hook({ email: 'mrs@example.test', type: 'soft', reason: 'mailbox full' });
  assert.equal((await contact()).email_bounced_at, null);
});

test('Postmark and SendGrid payloads are understood', async () => {
  await hook({ RecordType: 'Bounce', Type: 'HardBounce', Email: 'mrs@example.test', Description: 'unknown user' });
  assert.ok((await contact()).email_bounced_at);
  await db.query('UPDATE contact SET email_bounced_at = NULL');
  await hook([{ event: 'bounce', type: 'blocked', email: 'mrs@example.test' }]); // temporary
  assert.equal((await contact()).email_bounced_at, null);
  await hook([{ event: 'bounce', type: 'bounce', email: 'mrs@example.test', reason: '550 no such user' }]);
  assert.ok((await contact()).email_bounced_at);
});

test('the webhook needs the shared secret (query token or header)', async () => {
  assert.equal((await hook({ email: 'mrs@example.test', type: 'hard' }, '')).status, 403);
  assert.equal((await hook({ email: 'mrs@example.test', type: 'hard' }, '?token=wrong')).status, 403);
  assert.equal((await contact()).email_bounced_at, null);
  assert.equal((await hook({ email: 'mrs@example.test', type: 'hard' }, '', { 'x-webhook-secret': HOOK })).status, 200);
  assert.ok((await contact()).email_bounced_at);
});

test('the webhook is off when no secret is configured', async () => {
  const app = createApp({ db, messenger: env.messenger, now: env.now, config: { sessionSecret: SECRET, production: false } });
  const s = app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${s.address().port}/webhooks/email/bounce?token=x`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(res.status, 404);
  } finally { s.close(); }
});

test('editing the email clears the flag; re-saving the same address keeps it', async () => {
  await flagBounce({ db, email: 'mrs@example.test', reason: 'x' });
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'totty' }, body: JSON.stringify({ email: 'totty@example.test', password: PASSWORD }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const patch = (email) => fetch(`${base}/api/contacts/${world.contact.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'totty', Cookie: cookie }, body: JSON.stringify({ email }) });
  assert.equal((await patch('mrs@example.test')).status, 200);
  assert.ok((await contact()).email_bounced_at, 'same address: still flagged');
  const res = await patch('new@example.test');
  assert.equal((await res.json()).email_bounced_at, null);
  assert.equal((await contact()).email_bounced_at, null);
});

test('a hard SMTP rejection at send time flags the contact and still throws', async () => {
  const err = Object.assign(new Error('550 5.1.1 user unknown'), { responseCode: 550 });
  const mailer = withBounceFlagging({ async send() { throw err; } }, db);
  await assert.rejects(() => mailer.send({ to: 'mrs@example.test', subject: 's', text: 't' }), /user unknown/);
  assert.ok((await contact()).email_bounced_at);
});

test('a transient SMTP failure does not flag the contact', async () => {
  const mailer = withBounceFlagging({ async send() { throw Object.assign(new Error('421 try later'), { responseCode: 421 }); } }, db);
  await assert.rejects(() => mailer.send({ to: 'mrs@example.test', subject: 's', text: 't' }));
  assert.equal((await contact()).email_bounced_at, null);
});

test('helpers: hard-rejection detection and payload parsing', () => {
  assert.ok(isHardRejection({ responseCode: 553 }));
  assert.ok(isHardRejection({ rejected: ['a@b.c'] }));
  assert.ok(!isHardRejection({ responseCode: 451 }));
  assert.ok(!isHardRejection(new Error('ECONNRESET')));
  assert.deepEqual(parseBounceEvents(null), []);
  assert.deepEqual(parseBounceEvents({ foo: 1 }), []);
});
