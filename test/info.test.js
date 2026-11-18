// The public intake form (SPEC 5.1a): one general page, Submit, and the copy into the client's profile.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb, makeEnv, seedWorld, PASSWORD } from './helpers.js';
import { createApp } from '../src/app.js';

let db, env, world, server, base, kid, cookie, token;

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
  const res = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'totty@example.test', password: PASSWORD }) });
  cookie = res.headers.get('set-cookie').split(';')[0];
});
after(() => server.close());

const submit = (form, client) => fetch(`${base}/intake-api/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ form, client }) });
const staff = (path, method = 'GET', body) => fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'totty', Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
const initials = (p) => Object.fromEntries([1, 2, 3, 4, 5].map((i) => [`${p}_i${i}`, 'RL']));
const full = {
  child_first_name: 'Moshe', child_last_name: 'Levi',
  dob: '2019-03-14', gender: 'Male', parent_name: 'Rivka Levi', parent_relationship: 'Mother',
  street: '12 Main St', city: 'Lakewood', state: 'NJ', zip: '08701', phone: '(555) 555-0123', email: 'rivka@example.test', language: 'Yiddish',
  log_method: 'text', pref_text: true, consent_text: true, contact_sig: 'Rivka Levi',
  consent_ack: true, consent_sig: 'Rivka Levi', fee_ack: true, crisis_ack: true,
  anything_else: 'Likes trains', ...initials('nj'), loc_sig: 'Rivka Levi', evil: 'dropped',
};

test('the intake page is public and general (no token); the old per-client link is gone', async () => {
  const ok = await fetch(`${base}/intake`);
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /app\.js/);
  assert.equal((await fetch(`${base}/info/abc`)).status, 404);
});

test('Submit needs every required item and stores nothing when something is missing', async () => {
  const res = await submit({ child_first_name: 'Moshe', parent_name: 'Rivka Levi' });
  assert.equal(res.status, 400);
  const { missing } = await res.json();
  assert.ok(['child_last_name', 'phone', 'consent_sig', 'state'].every((k) => missing.includes(k)));
  assert.equal((await db.query('SELECT 1 FROM intake_submission')).rows.length, 0);
});

test('the location section needs the initials and signature for the chosen state; New York also needs the ordering provider', async () => {
  const ny = { ...full, state: 'NY' };
  const m = (await (await submit(ny)).json()).missing;
  assert.ok(m.includes('ny_provider') && m.includes('ny_i1') && !m.includes('nj_i1'));
});

test('the Release of Information is optional, but once started it needs a direction, provider and signature', async () => {
  const res = await submit({ ...full, roi_info: 'School records' });
  assert.equal(res.status, 400);
  assert.deepEqual((await res.json()).missing.sort(), ['roi_direction', 'roi_provider', 'roi_sig']);
});

test('a form sent with the client link id is copied into that profile at once, whatever name was typed', async () => {
  assert.equal((await submit({ ...full, child_first_name: 'Moishy' }, token)).status, 200);
  const { rows: [s] } = await db.query('SELECT client_id, imported_at, form FROM intake_submission');
  assert.equal(s.client_id, kid);
  assert.ok(s.imported_at && s.form.evil === undefined && s.form.signed_at.loc_sig);
  const { rows: [c] } = await db.query(
    'SELECT intake_status, dob::text AS dob, gender, notes, street_address, city, state, zip, info_submitted_at, intake_form FROM client WHERE id = $1', [kid]);
  assert.deepEqual({ ...c, info_submitted_at: Boolean(c.info_submitted_at), intake_form: undefined },
    { intake_status: 'paperwork_received', dob: '2019-03-14', gender: 'Male', notes: 'Likes trains', street_address: '12 Main St', city: 'Lakewood', state: 'NJ', zip: '08701', info_submitted_at: true, intake_form: undefined });
  assert.equal(c.intake_form.log_method, 'text');
  const { rows } = await db.query('SELECT name, email, phone, language, preferred_channel, consent_given_at FROM contact WHERE client_id = $1', [kid]);
  assert.equal(rows.length, 1);
  assert.deepEqual({ ...rows[0], consent_given_at: Boolean(rows[0].consent_given_at) },
    { name: 'Rivka Levi', email: 'rivka@example.test', phone: '+15555550123', language: 'yi', preferred_channel: 'sms', consent_given_at: true });
  assert.equal((await db.query('SELECT 1 FROM consult_email WHERE client_id = $1', [kid])).rows.length, 1);
});

test('the link id pre-fills the child name; an unknown id gets nothing and the form just waits', async () => {
  assert.deepEqual(await (await fetch(`${base}/intake-api/client?c=${token}`)).json(), { first_name: 'Moshe', last_name: 'Levi' });
  assert.deepEqual(await (await fetch(`${base}/intake-api/client?c=nope`)).json(), {});
  assert.equal((await submit({ ...full, child_first_name: 'Zed' }, 'nope')).status, 200);
  await db.query("DELETE FROM intake_submission WHERE child_first_name = 'Zed'");
});

test('copying fills empty fields only: what Yisroel already has stays', async () => {
  await db.query(`UPDATE client SET city = 'Brooklyn' WHERE id = $1`, [kid]);
  await submit({ ...full, city: 'Lakewood' }, token);
  assert.equal((await db.query('SELECT city FROM client WHERE id = $1', [kid])).rows[0].city, 'Brooklyn');
  assert.equal((await db.query('SELECT 1 FROM contact WHERE client_id = $1', [kid])).rows.length, 1);
});

test('a form without a link id waits, even when the name matches a client; staff can copy it into a client or create one from it', async () => {
  await submit({ ...full, child_first_name: 'Dovid', child_last_name: 'Katz' });
  await submit(full); // same name as Moshe Levi, but no link id
  const list = await (await staff('/intake-submissions')).json();
  assert.deepEqual(list.map((x) => x.child_first_name + ' ' + x.child_last_name).sort(), ['Dovid Katz', 'Moshe Levi']);
  list.sort((a, b) => a.child_last_name.localeCompare(b.child_last_name)); // Katz first
  assert.equal((await fetch(`${base}/api/intake-submissions`)).status, 401);
  assert.equal((await staff(`/intake-submissions/${list[0].id}/import`, 'POST', {})).status, 400);
  const r = await (await staff(`/intake-submissions/${list[0].id}/import`, 'POST', { create: true })).json();
  assert.ok(r.created && r.status_advanced);
  const { rows: [c] } = await db.query('SELECT first_name, intake_status, zip FROM client WHERE id = $1', [r.client_id]);
  assert.deepEqual(c, { first_name: 'Dovid', intake_status: 'paperwork_received', zip: '08701' });
  assert.equal((await (await staff('/intake-submissions')).json()).length, 1); // only the unlinked Moshe Levi form is left
  assert.equal((await staff(`/intake-submissions/${list[0].id}/import`, 'POST', { create: true })).status, 404);
});
