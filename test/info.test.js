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

const submit = (fields, t = token) => fetch(`${base}/info/${t}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) });

test('every client has an unguessable link; a wrong one is a 404', async () => {
  assert.ok(token.length >= 60);
  assert.equal((await fetch(`${base}/info/${token}`)).status, 200);
  assert.equal((await fetch(`${base}/info/nope`)).status, 404);
});

test('Submit fills the profile, records consent, and moves the client to information submitted with a consult draft', async () => {
  assert.equal((await submit({ name: '' , email: 'bad' })).status, 400);
  const res = await submit({ name: 'Rivka Levi', relationship: 'Mother', phone: '+15555550123', email: 'rivka@example.test', dob: '2019-03-14', gender: 'Male', notes: 'Likes trains', consent: '1' });
  assert.equal(res.status, 200);
  const { rows: [c] } = await db.query('SELECT intake_status, dob::text AS dob, gender, notes, info_submitted_at FROM client WHERE id = $1', [kid]);
  assert.deepEqual({ ...c, info_submitted_at: Boolean(c.info_submitted_at) }, { intake_status: 'paperwork_received', dob: '2019-03-14', gender: 'Male', notes: 'Likes trains', info_submitted_at: true });
  const { rows: [p] } = await db.query('SELECT name, email, phone, consent_given_at FROM contact WHERE client_id = $1', [kid]);
  assert.equal(p.name, 'Rivka Levi');
  assert.ok(p.consent_given_at);
  assert.equal((await db.query('SELECT 1 FROM consult_email WHERE client_id = $1', [kid])).rows.length, 1);
  assert.match(await (await fetch(`${base}/info/${token}`)).text(), /was submitted/);
});
