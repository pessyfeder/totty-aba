import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb, makeEnv, seedWorld, PASSWORD } from './helpers.js';
import { createApp } from '../src/app.js';
import { approve, buildConsultEmail, sendApproved } from '../src/consult-email.js';

const LINK = 'https://calendar.google.com/book/abc';
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

async function newClient(first, { email = 'rivka@example.test', status = 'paperwork_sent' } = {}) {
  const { rows: [c] } = await db.query(
    `INSERT INTO client (clinician_id, first_name, last_name, admission_date, latitude, longitude, timezone, intake_status)
     VALUES ($1, $2, 'Levi', '2026-11-01', 40.0979, -74.2176, 'America/New_York', $3) RETURNING *`, [world.clinician.id, first, status]);
  await db.query(`INSERT INTO contact (client_id, name, email) VALUES ($1, 'Rivka Levi', $2)`, [c.id, email]);
  return c;
}
const setStatus = (id, s) => call('POST', `/api/clients/${id}/intake-status`, { intake_status: s });
const emailOf = (id) => call('GET', `/api/clients/${id}/consult-email`);

test('the email is plain: the child\'s first name and the link, no last name or clinical detail', () => {
  const m = buildConsultEmail({ client: { first_name: 'Moshe', last_name: 'Levi' }, contact: { name: 'Rivka Levi' }, clinician: { name: 'Yisroel Feder, LBA, BCBA' }, link: LINK });
  assert.match(m.subject, /Moshe/);
  assert.ok(m.text.includes(LINK) && m.text.includes('Hi Rivka Levi'));
  assert.ok(!/Levi\b(?!,)/.test(m.text.replace('Rivka Levi', '')), 'child last name must not appear');
});

test('no draft before paperwork is received; reaching that status drafts one, waiting for approval', async () => {
  const c = await newClient('Moshe');
  assert.equal((await emailOf(c.id)).json, null);
  await setStatus(c.id, 'paperwork_received');
  const e = (await emailOf(c.id)).json;
  assert.equal(e.status, 'pending_approval');
  assert.equal(e.to, 'rivka@example.test');
  assert.deepEqual(e.problems, ['Set the consultation booking link in Settings first.']);
  assert.equal(env.mails.length, 0, 'nothing is sent before approval');
});

test('approval is refused until a booking link is set; then it sends once and only once', async () => {
  const c = await newClient('Yosef', { status: 'paperwork_received' });
  await setStatus(c.id, 'paperwork_received');
  assert.equal((await call('POST', `/api/clients/${c.id}/consult-email/approve`)).status, 400);
  assert.equal((await call('PUT', '/api/settings', { consult_booking_url: LINK })).status, 200);

  const before = env.mails.length;
  const ok = await call('POST', `/api/clients/${c.id}/consult-email/approve`);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.status, 'sent');
  assert.equal(ok.json.to, 'rivka@example.test');
  assert.equal(env.mails.length, before + 1);
  const m = env.mails.at(-1);
  assert.equal(m.to, 'rivka@example.test');
  assert.ok(m.text.includes(LINK) && m.text.includes('Yosef'));

  assert.equal((await call('POST', `/api/clients/${c.id}/consult-email/approve`)).status, 400); // already sent
  await sendApproved({ db, mailer: env.mailer, now: env.now });
  assert.equal(env.mails.length, before + 1);
  // Re-reaching the status does not draft a second email.
  await setStatus(c.id, 'paperwork_sent');
  await setStatus(c.id, 'paperwork_received');
  assert.equal((await emailOf(c.id)).json.status, 'sent');
});

test('a client with no parent email cannot be approved until one is added', async () => {
  const c = await newClient('Dovid2', { email: '' });
  await setStatus(c.id, 'paperwork_received');
  const e = (await emailOf(c.id)).json;
  assert.deepEqual(e.problems, ['Add an email address for a parent or guardian first.']);
  assert.equal((await call('POST', `/api/clients/${c.id}/consult-email/approve`)).status, 400);
  await db.query(`UPDATE contact SET email = 'new@example.test' WHERE client_id = $1`, [c.id]);
  assert.equal((await call('POST', `/api/clients/${c.id}/consult-email/approve`)).json.status, 'sent');
});

test('declining stops the email', async () => {
  const c = await newClient('Avrumi');
  await setStatus(c.id, 'paperwork_received');
  const n = env.mails.length;
  assert.equal((await call('POST', `/api/clients/${c.id}/consult-email/cancel`)).json.status, 'cancelled');
  assert.equal((await call('POST', `/api/clients/${c.id}/consult-email/approve`)).status, 400);
  assert.equal(env.mails.length, n);
});

test('an approved email waits out the family\'s Shabbos and goes out after nightfall', async () => {
  const c = await newClient('Shmuel');
  await setStatus(c.id, 'paperwork_received');
  await approve(db, c.id); // approved, not yet sent
  const n = env.mails.length;
  env.at('2026-11-07T15:00:00Z'); // Shabbos afternoon
  assert.deepEqual(await sendApproved({ db, mailer: env.mailer, now: env.now }), []);
  assert.equal(env.mails.length, n);
  env.at('2026-11-08T14:00:00Z'); // Sunday
  assert.deepEqual(await sendApproved({ db, mailer: env.mailer, now: env.now }), [c.id]);
  assert.equal(env.mails.length, n + 1);
  env.at('2026-11-04T15:00:00Z');
});

test('a failing mailer retries, then gives up and says why; a moved-on client is not emailed', async () => {
  const c = await newClient('Berel');
  await setStatus(c.id, 'paperwork_received');
  await approve(db, c.id);
  const boom = { async send() { throw new Error('smtp down'); } };
  for (let i = 0; i < 3; i++) await sendApproved({ db, mailer: boom, now: env.now });
  const e = (await emailOf(c.id)).json;
  assert.equal(e.status, 'failed');
  assert.match(e.last_error, /smtp down/);

  const d = await newClient('Zalman');
  await setStatus(d.id, 'paperwork_received');
  await approve(db, d.id);
  await setStatus(d.id, 'consult_scheduled'); // consult already booked by other means
  const n = env.mails.length;
  await sendApproved({ db, mailer: env.mailer, now: env.now });
  assert.equal(env.mails.length, n);
  assert.equal((await emailOf(d.id)).json.status, 'cancelled');
});

test('another clinician cannot see or approve the email; the dashboard lists emails awaiting approval', async () => {
  const c = await newClient('Lipa');
  await setStatus(c.id, 'paperwork_received');
  const dash = (await call('GET', '/api/dashboard')).json;
  assert.ok(dash.emailsToApprove.some((x) => x.id === c.id));
  const { rows: [other] } = await db.query(`INSERT INTO clinician (name, email, password_hash, timezone, latitude, longitude) VALUES ('X', 'x@example.test', 'x', 'America/New_York', 40, -74) RETURNING id`);
  const { rows: [theirs] } = await db.query(
    `INSERT INTO client (clinician_id, first_name, last_name, admission_date, latitude, longitude, timezone, intake_status) VALUES ($1, 'A', 'B', '2026-11-01', 40, -74, 'America/New_York', 'paperwork_received') RETURNING id`, [other.id]);
  assert.equal((await emailOf(theirs.id)).status, 404);
  assert.equal((await call('POST', `/api/clients/${theirs.id}/consult-email/approve`)).status, 404);
});
