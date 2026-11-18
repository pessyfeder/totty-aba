// Parents' profile page (SPEC 5.1a): the token link, Submit, and what it moves.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb, makeEnv, seedWorld } from './helpers.js';
import { createApp } from '../src/app.js';

let db, env, world, server, base, token, kid;

before(async () => {
  db = await makeDb();
  env = makeEnv(db, '2026-11-04T15:00:00Z');
  world = await seedWorld(db);
  const { rows: [c] } = await db.query(
    `INSERT INTO client (clinician_id, first_name, last_name, admission_date, latitude, longitude, timezone)
     VALUES ($1, 'Moshe', 'Levi', '2026-11-01', 40.0979, -74.2176, 'America/New_York') RETURNING *`, [world.clinician.id]);
  kid = c.id; token = c.info_token;
  const app = createApp({ db, messenger: env.messenger, mailer: env.mailer, now: env.now, config: { sessionSecret: 'x'.repeat(40), production: false } });
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const api = (path, method = 'GET', body, t = token) => fetch(`${base}/info-api/${t}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const full = { dob: '2019-03-14', gender: 'Male', notes: 'Likes trains', parent: { name: 'Rivka Levi', relationship: 'Mother', phone: '(555) 555-0123', email: 'rivka@example.test', consent: true } };

test('every client has an unguessable link that opens the app page; a wrong one is a 404', async () => {
  assert.ok(token.length >= 60);
  const ok = await fetch(`${base}/info/${token}`);
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /app\.js/);
  assert.equal((await fetch(`${base}/info/nope`)).status, 404);
  assert.equal((await api('', 'GET', undefined, 'nope')).status, 404);
  assert.equal((await (await api('')).json()).child.first_name, 'Moshe');
});

test('entries save as typed without changing the status; Submit needs every required field', async () => {
  assert.equal((await api('', 'PUT', { dob: '2019-03-14', parent: { name: 'Rivka Levi', phone: 'junk' } })).status, 200);
  const { rows: [c] } = await db.query('SELECT intake_status, dob::text AS dob FROM client WHERE id = $1', [kid]);
  assert.deepEqual(c, { intake_status: 'inquiry', dob: '2019-03-14' });
  assert.equal((await db.query('SELECT name, phone FROM contact WHERE client_id = $1', [kid])).rows[0].phone, null);
  const res = await api('/submit', 'POST', { dob: '2019-03-14', parent: { name: 'Rivka Levi' } });
  assert.equal(res.status, 400);
  assert.ok((await res.json()).missing.includes('phone'));
  assert.equal((await db.query('SELECT intake_status FROM client WHERE id = $1', [kid])).rows[0].intake_status, 'inquiry');
});

test('Submit moves the client to information submitted with a consult draft; the contact gets an E.164 phone and consent', async () => {
  assert.equal((await api('/submit', 'POST', full)).status, 200);
  const { rows: [c] } = await db.query('SELECT intake_status, dob::text AS dob, gender, notes, info_submitted_at FROM client WHERE id = $1', [kid]);
  assert.deepEqual({ ...c, info_submitted_at: Boolean(c.info_submitted_at) }, { intake_status: 'paperwork_received', dob: '2019-03-14', gender: 'Male', notes: 'Likes trains', info_submitted_at: true });
  const { rows } = await db.query('SELECT name, email, phone, consent_given_at FROM contact WHERE client_id = $1', [kid]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].phone, '+15555550123');
  assert.ok(rows[0].consent_given_at);
  assert.equal((await db.query('SELECT 1 FROM consult_email WHERE client_id = $1', [kid])).rows.length, 1);
  assert.equal((await api('/submit', 'POST', full)).status, 200); // resubmitting is allowed and changes nothing else
});
