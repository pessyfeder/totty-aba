// The public intake form (SPEC 5.1a): one general page; Submit creates the client and records the signed consent.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb, makeEnv, seedWorld, PASSWORD } from './helpers.js';
import { createApp } from '../src/app.js';

let db, env, world, server, base, cookie;

before(async () => {
  db = await makeDb();
  env = makeEnv(db, '2026-11-04T15:00:00Z');
  world = await seedWorld(db);
  const app = createApp({ db, messenger: env.messenger, mailer: env.mailer, now: env.now, config: { sessionSecret: 'x'.repeat(40), production: false } });
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'totty@example.test', password: PASSWORD }) });
  cookie = res.headers.get('set-cookie').split(';')[0];
});
after(() => server.close());

const submit = (form) => fetch(`${base}/intake-api/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ form }) });
const staff = (path, method = 'GET', body) => fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'totty', Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
const clientNamed = async (first) => (await db.query('SELECT * FROM client WHERE first_name = $1', [first])).rows;
const initials = (p) => Object.fromEntries([1, 2, 3, 4, 5].map((i) => [`${p}_i${i}`, 'RL']));
const full = {
  child_first_name: 'Moshe', child_last_name: 'Levi',
  dob: '2019-03-14', gender: 'Male', parent_name: 'Rivka Levi', parent_relationship: 'Mother',
  street: '12 Main St', city: 'Lakewood', state: 'NJ', zip: '08701', phone: '(555) 555-0123', email: 'rivka@example.test', language: 'Yiddish',
  pref_text: true,
  consent_ack: true, consent_sig: 'Rivka Levi', fee_ack: true,
  anything_else: 'Likes trains', ...initials('nj'), loc_sig: 'Rivka Levi', evil: 'dropped',
};

test('the intake page is public and general (no token); the old per-client link is gone', async () => {
  const ok = await fetch(`${base}/intake`);
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /app\.js/);
  assert.equal((await fetch(`${base}/info/abc`)).status, 404);
  assert.equal((await fetch(`${base}/intake-api/client?c=x`)).status, 404);
});

test('Submit needs every required item and stores nothing when something is missing', async () => {
  const res = await submit({ child_first_name: 'Moshe', parent_name: 'Rivka Levi' });
  assert.equal(res.status, 400);
  const { missing } = await res.json();
  assert.ok(['child_last_name', 'phone', 'consent_sig', 'state'].every((k) => missing.includes(k)));
  const { rows } = await db.query("SELECT 1 FROM client WHERE first_name = 'Moshe'");
  assert.equal(rows.length, 0);
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

test('Submit without the signed consents is refused, naming what is missing, and creates no client', async () => {
  const noSign = { ...full, consent_sig: '', consent_ack: false, loc_sig: '' };
  const res = await submit(noSign);
  assert.equal(res.status, 400);
  const { error, missing } = await res.json();
  assert.deepEqual(['consent_ack', 'consent_sig', 'loc_sig'].filter((k) => !missing.includes(k)), []);
  assert.match(error, /Informed Consent/);
  assert.equal((await clientNamed('Moshe')).length, 0);
});

test('Submit creates the client, the parent contact (text/email consent is recorded later, at the consultation); unknown keys are dropped', async () => {
  const res = await submit(full);
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.submitted, true);
  assert.equal(out.booking_url, null, 'no booking link is set yet');
  const [c] = await clientNamed('Moshe');
  assert.deepEqual(
    { intake_status: c.intake_status, last: c.last_name, gender: c.gender, street: c.street_address, city: c.city, state: c.state, zip: c.zip, notes: c.notes, loc: c.location_name,
      signer: c.consent_signed_by, signed: Boolean(c.consent_signed_at), submitted: Boolean(c.info_submitted_at), owner: c.clinician_id, tz: c.timezone },
    { intake_status: 'paperwork_received', last: 'Levi', gender: 'Male', street: '12 Main St', city: 'Lakewood', state: 'NJ', zip: '08701', notes: 'Likes trains', loc: 'Lakewood, NJ',
      signer: 'Rivka Levi', signed: true, submitted: true, owner: world.clinician.id, tz: 'America/New_York' });
  assert.equal(c.dob.toISOString().slice(0, 10), '2019-03-14');
  assert.equal(c.intake_form.evil, undefined);
  assert.ok(c.intake_form.signed_at.loc_sig);
  const { rows } = await db.query('SELECT name, relationship, email, phone, language, preferred_channel, consent_given_at FROM contact WHERE client_id = $1', [c.id]);
  assert.equal(rows.length, 1);
  assert.deepEqual({ ...rows[0], consent_given_at: Boolean(rows[0].consent_given_at) },
    { name: 'Rivka Levi', relationship: 'Mother', email: 'rivka@example.test', phone: '+15555550123', language: 'yi', preferred_channel: 'sms', consent_given_at: false });
  // The consultation email is drafted for Totty's approval; nothing is sent.
  assert.equal((await db.query('SELECT status FROM consult_email WHERE client_id = $1', [c.id])).rows[0].status, 'pending_approval');
  assert.equal(env.mails.length, 0);
  assert.equal((await db.query(`SELECT 1 FROM audit_log WHERE entity = 'client' AND entity_id = $1 AND action = 'create'`, [c.id])).rows.length, 1);
});

test('after Submit the response carries the consultation booking link set in Settings', async () => {
  assert.equal((await staff('/settings', 'PUT', { consult_booking_url: 'https://example.test/book' })).status, 200);
  const out = await (await submit({ ...full, child_first_name: 'Dovid', child_last_name: 'Katz', p2_name: 'Yaakov Katz', p2_relationship: 'Father' })).json();
  assert.equal(out.booking_url, 'https://example.test/book');
  const [d] = (await clientNamed('Dovid')).filter((x) => x.last_name === 'Katz');
  const { rows } = await db.query('SELECT name FROM contact WHERE client_id = $1 ORDER BY name', [d.id]);
  assert.deepEqual(rows.map((r) => r.name), ['Rivka Levi', 'Yaakov Katz']);
});

test('the new clients show up for Totty, and the old waiting list and per-client link are gone', async () => {
  const list = await (await staff('/clients')).json();
  assert.ok(list.some((x) => x.first_name === 'Moshe' && x.intake_status === 'paperwork_received'));
  assert.equal((await staff('/intake-submissions')).status, 404);
  assert.equal((await staff('/clients', 'POST', { first_name: 'A', last_name: 'B' })).status, 404);
});

test('a ticked text-consent box records consent on that parent\'s contact, so the consult text can be approved', async () => {
  const res = await submit({ ...full, child_first_name: 'Texty', text_consent: true, p2_name: 'Dov Levi', p2_phone: '5555550199', p2_text_consent: false });
  assert.equal(res.status, 200);
  const [c] = await clientNamed('Texty');
  const { rows } = await db.query('SELECT name, consent_given_at, consent_note FROM contact WHERE client_id = $1 ORDER BY name DESC', [c.id]); // Rivka before Dov
  assert.ok(rows[0].consent_given_at && /intake form/.test(rows[0].consent_note));
  assert.equal(rows[1].consent_given_at, null, 'the second parent did not tick it');
  const { rows: [t] } = await db.query('SELECT status FROM consult_text WHERE client_id = $1', [c.id]);
  assert.equal(t.status, 'pending_approval');
});
