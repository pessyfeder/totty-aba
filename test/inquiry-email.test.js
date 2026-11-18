import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb, makeEnv, seedWorld, PASSWORD } from './helpers.js';
import { createApp } from '../src/app.js';
import { approve, buildInquiryEmail, sendApproved } from '../src/inquiry-email.js';

const LINK = 'https://example.test/client-info';
let db, env, world, server, base, cookie;

before(async () => {
  db = await makeDb();
  env = makeEnv(db, '2026-11-04T15:00:00Z'); // Wednesday, open
  world = await seedWorld(db);
  const app = createApp({ db, messenger: env.messenger, mailer: env.mailer, now: env.now, config: { sessionSecret: 'x'.repeat(40), production: false } });
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'totty' }, body: JSON.stringify({ email: 'totty@example.test', password: PASSWORD }) });
  cookie = r.headers.get('set-cookie').split(';')[0];
});
after(() => server.close());

const call = (method, path, body) => fetch(base + path, {
  method,
  headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'totty', Cookie: cookie },
  body: body ? JSON.stringify(body) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

async function newClient(first, { email = 'rivka@example.test', status = 'inquiry' } = {}) {
  const { rows: [c] } = await db.query(
    `INSERT INTO client (clinician_id, first_name, last_name, admission_date, latitude, longitude, timezone, intake_status)
     VALUES ($1, $2, 'Levi', '2026-11-01', 40.0979, -74.2176, 'America/New_York', $3) RETURNING *`, [world.clinician.id, first, status]);
  await db.query(`INSERT INTO contact (client_id, name, email) VALUES ($1, 'Rivka Levi', $2)`, [c.id, email]);
  return c;
}
const setStatus = (id, s) => call('POST', `/api/clients/${id}/intake-status`, { intake_status: s });
const emailOf = (id) => call('GET', `/api/clients/${id}/inquiry-email`);

test('the email is plain: first name, the form link, no last name', () => {
  const m = buildInquiryEmail({ client: { first_name: 'Moshe', last_name: 'Levi' }, contact: { name: 'Rivka Levi' }, clinician: { name: 'Totty' }, link: LINK });
  assert.match(m.subject, /Moshe/);
  assert.ok(m.text.includes(LINK) && m.text.includes('Hi Rivka Levi') && /New Jersey or New York/.test(m.text));
  assert.ok(!/Levi\b(?!,)/.test(m.text.replace('Rivka Levi', '')), 'child last name must not appear');
});

test('the client information link is a setting: any web address, blank clears it', async () => {
  assert.equal((await call('PUT', '/api/settings', { client_info_url: 'nope' })).status, 400);
  assert.equal((await call('PUT', '/api/settings', { client_info_url: LINK })).json.client_info_url, LINK);
  assert.equal((await call('GET', '/api/settings')).json.client_info_url, LINK);
  assert.equal((await call('PUT', '/api/settings', { client_info_url: '' })).json.client_info_url, '');
});

test('a client created through the API starts at reached out with a draft awaiting approval', async () => {
  const r = await call('POST', '/api/clients', { first_name: 'Dov', last_name: 'Katz', admission_date: '2026-11-01', latitude: 40.1, longitude: -74.2, timezone: 'America/New_York' });
  assert.equal(r.status, 201);
  const e = (await emailOf(r.json.id)).json;
  assert.equal(e.status, 'pending_approval');
  assert.equal(env.mails.length, 0, 'nothing is sent before approval');
});

test('approval is refused until the link is set; then it sends once and only once', async () => {
  const c = await newClient('Yosef');
  await setStatus(c.id, 'paperwork_sent');
  await setStatus(c.id, 'inquiry'); // back to reached out: drafts
  assert.deepEqual((await emailOf(c.id)).json.problems, ['Set the client information page link in Settings first.']);
  assert.equal((await call('POST', `/api/clients/${c.id}/inquiry-email/approve`)).status, 400);
  await call('PUT', '/api/settings', { client_info_url: LINK });

  const n = env.mails.length;
  const ok = await call('POST', `/api/clients/${c.id}/inquiry-email/approve`);
  assert.equal(ok.json.status, 'sent', JSON.stringify(ok.json));
  assert.equal(env.mails.length, n + 1);
  const m = env.mails.at(-1);
  assert.equal(m.to, 'rivka@example.test');
  assert.ok(m.text.includes(LINK) && m.text.includes('Yosef'));
  assert.equal((await call('POST', `/api/clients/${c.id}/inquiry-email/approve`)).status, 400);
  await sendApproved({ db, mailer: env.mailer, now: env.now });
  assert.equal(env.mails.length, n + 1);
});

test('no parent email blocks approval until one is added; declining stops it', async () => {
  const c = await newClient('Dovid2', { email: '' });
  await setStatus(c.id, 'paperwork_sent');
  await setStatus(c.id, 'inquiry');
  assert.deepEqual((await emailOf(c.id)).json.problems, ['Add an email address for a parent or guardian first.']);
  await db.query(`UPDATE contact SET email = 'new@example.test' WHERE client_id = $1`, [c.id]);
  const d = await newClient('Avrumi');
  await setStatus(d.id, 'paperwork_sent');
  await setStatus(d.id, 'inquiry');
  const n = env.mails.length;
  assert.equal((await call('POST', `/api/clients/${d.id}/inquiry-email/cancel`)).json.status, 'cancelled');
  assert.equal((await call('POST', `/api/clients/${d.id}/inquiry-email/approve`)).status, 400);
  assert.equal(env.mails.length, n);
});

test('an approved email waits out Shabbos, and is dropped if the client moved on', async () => {
  const c = await newClient('Shmuel');
  await setStatus(c.id, 'paperwork_sent');
  await setStatus(c.id, 'inquiry');
  await approve(db, c.id);
  const n = env.mails.length;
  env.at('2026-11-07T15:00:00Z'); // Shabbos afternoon
  assert.deepEqual(await sendApproved({ db, mailer: env.mailer, now: env.now }), []);
  env.at('2026-11-08T14:00:00Z');
  assert.deepEqual(await sendApproved({ db, mailer: env.mailer, now: env.now }), [c.id]);
  assert.equal(env.mails.length, n + 1);
  env.at('2026-11-04T15:00:00Z');

  const d = await newClient('Zalman');
  await setStatus(d.id, 'paperwork_sent');
  await setStatus(d.id, 'inquiry');
  await approve(db, d.id);
  await setStatus(d.id, 'paperwork_sent'); // Totty sent the paperwork by other means
  await sendApproved({ db, mailer: env.mailer, now: env.now });
  assert.equal(env.mails.length, n + 1);
  assert.equal((await emailOf(d.id)).json.status, 'cancelled');
});

test('another clinician cannot see or approve the email', async () => {
  const { rows: [other] } = await db.query(`INSERT INTO clinician (name, email, password_hash, timezone, latitude, longitude) VALUES ('X', 'x@example.test', 'x', 'America/New_York', 40, -74) RETURNING id`);
  const { rows: [theirs] } = await db.query(
    `INSERT INTO client (clinician_id, first_name, last_name, admission_date, latitude, longitude, timezone) VALUES ($1, 'A', 'B', '2026-11-01', 40, -74, 'America/New_York') RETURNING id`, [other.id]);
  assert.equal((await emailOf(theirs.id)).status, 404);
  assert.equal((await call('POST', `/api/clients/${theirs.id}/inquiry-email/approve`)).status, 404);
});
