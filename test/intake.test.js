import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb, makeEnv, seedWorld, PASSWORD } from './helpers.js';
import { createApp } from '../src/app.js';
import { parseForm, encrypt, decrypt } from '../src/intake.js';

let db, world, server, base, cookie;

before(async () => {
  db = await makeDb();
  const env = makeEnv(db, '2026-11-04T15:00:00Z'); // Wednesday, open
  world = await seedWorld(db);
  const app = createApp({ db, messenger: env.messenger, now: env.now, config: { sessionSecret: 'x'.repeat(40), production: false } });
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'totty' }, body: JSON.stringify({ email: 'totty@example.test', password: PASSWORD }) });
  cookie = r.headers.get('set-cookie').split(';')[0];
});
after(() => server.close());

const upload = (path, name, body) => fetch(base + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/octet-stream', 'X-Requested-With': 'totty', 'X-Filename': encodeURIComponent(name), Cookie: cookie },
  body,
});
const get = (path) => fetch(base + path, { headers: { 'X-Requested-With': 'totty', Cookie: cookie } });

/** A new inquiry client with only the fields creation requires. */
async function newClient(first = 'Moshe', last = 'Levi', extra = {}) {
  const { rows: [c] } = await db.query(
    `INSERT INTO client (clinician_id, first_name, last_name, admission_date, latitude, longitude, timezone, intake_status, gender, notes)
     VALUES ($1, $2, $3, '2026-11-01', 40.0979, -74.2176, 'America/New_York', 'paperwork_sent', $4, $5) RETURNING *`,
    [world.clinician.id, first, last, extra.gender ?? null, extra.notes ?? null]);
  return c;
}

const CSV = [
  `"Child's first name","Child's last name","Date of birth","Gender","City","Parent/guardian name","Relationship","Phone number","Email address","Preferred language","How would you prefer to be contacted?","Anything else we should know?"`,
  `Moshe,Levi,3/14/2019,Male,Lakewood,"Rivka Levi",Mother,(732) 555-0142,rivka@example.test,Yiddish,Text message,"Likes trains, hates loud noises"`,
].join('\r\n');

test('parseForm maps typical form-builder headers and normalises values', () => {
  const f = parseForm('form.csv', Buffer.from(CSV));
  assert.deepEqual(f.client, { first_name: 'Moshe', last_name: 'Levi', dob: '2019-03-14', gender: 'Male', location_name: 'Lakewood', notes: 'Likes trains, hates loud noises' });
  assert.deepEqual(f.contacts, [{ name: 'Rivka Levi', relationship: 'Mother', phone: '+17325550142', email: 'rivka@example.test', language: 'yi', preferred_channel: 'sms' }]);
  assert.deepEqual(f.warnings, []);
});

test('parseForm rejects several submissions and warns on unusable values instead of guessing', () => {
  assert.throws(() => parseForm('f.csv', Buffer.from(`${CSV}\r\n${CSV.split('\r\n')[1]}`)), /2 submissions/);
  const f = parseForm('f.json', Buffer.from(JSON.stringify({ first_name: 'A', dob: 'sometime', phone: '12' })));
  assert.equal(f.client.dob, undefined);
  assert.equal(f.warnings.length, 2);
});

test('encryption round-trips and is bound to the document id', () => {
  const blob = encrypt('secret', 'doc-1', Buffer.from('PHI'));
  assert.ok(!blob.includes('PHI'));
  assert.equal(decrypt('secret', 'doc-1', blob).toString(), 'PHI');
  assert.throws(() => decrypt('secret', 'doc-2', blob));
  assert.throws(() => decrypt('other', 'doc-1', blob));
});

test('uploading the form fills empty fields, adds the contact, and sets paperwork_received', async () => {
  const c = await newClient();
  const res = await upload(`/api/clients/${c.id}/intake/form`, 'intake.csv', CSV);
  assert.equal(res.status, 201);
  const out = await res.json();
  assert.deepEqual(out.conflicts, []);
  assert.equal(out.status_advanced, true);
  const { rows: [after] } = await db.query('SELECT dob::text AS dob, gender, location_name, notes, intake_status FROM client WHERE id = $1', [c.id]);
  assert.deepEqual(after, { dob: '2019-03-14', gender: 'Male', location_name: 'Lakewood', notes: 'Likes trains, hates loud noises', intake_status: 'paperwork_received' });
  const { rows: contacts } = await db.query('SELECT * FROM contact WHERE client_id = $1', [c.id]);
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].phone, '+17325550142');
  assert.equal(contacts[0].language, 'yi');
  assert.equal(contacts[0].consent_given_at, null, 'a form never records consent');
});

test('conflicts keep the clinician value and name the field and both values', async () => {
  const c = await newClient('Moishe', 'Levi', { gender: 'M', notes: 'Entered by Totty' });
  const out = await (await upload(`/api/clients/${c.id}/intake/form`, 'intake.csv', CSV)).json();
  const byField = Object.fromEntries(out.conflicts.map((x) => [x.field, x]));
  assert.deepEqual(byField['first name'], { field: 'first name', entered: 'Moishe', form: 'Moshe' });
  assert.deepEqual(byField.gender, { field: 'gender', entered: 'M', form: 'Male' });
  assert.deepEqual(byField.notes, { field: 'notes', entered: 'Entered by Totty', form: 'Likes trains, hates loud noises' });
  const { rows: [row] } = await db.query('SELECT first_name, gender, dob::text AS dob FROM client WHERE id = $1', [c.id]);
  assert.deepEqual(row, { first_name: 'Moishe', gender: 'M', dob: '2019-03-14' }, 'his values stay, empty ones fill');
  // The page lists the same open conflicts, and they clear once the values agree.
  const page = await (await get(`/api/clients/${c.id}/intake`)).json();
  assert.equal(page.conflicts.length, 3);
  await db.query(`UPDATE client SET first_name = 'Moshe', gender = 'Male', notes = 'Likes trains, hates loud noises' WHERE id = $1`, [c.id]);
  assert.equal((await (await get(`/api/clients/${c.id}/intake`)).json()).conflicts.length, 0);
});

test('re-uploading is safe: an existing contact is matched, not duplicated', async () => {
  const c = await newClient();
  await upload(`/api/clients/${c.id}/intake/form`, 'intake.csv', CSV);
  await upload(`/api/clients/${c.id}/intake/form`, 'intake.csv', CSV);
  assert.equal((await db.query('SELECT 1 FROM contact WHERE client_id = $1', [c.id])).rows.length, 1);
});

test('documents are attached encrypted, listed, and downloadable only by the owner', async () => {
  const c = await newClient();
  const pdf = Buffer.from('%PDF-1.4 consent form for Moshe');
  const res = await upload(`/api/clients/${c.id}/documents`, 'consent.pdf', pdf);
  assert.equal(res.status, 201);
  const { document_id } = await res.json();
  const { rows: [stored] } = await db.query('SELECT data FROM client_document WHERE id = $1', [document_id]);
  assert.ok(!Buffer.from(stored.data).includes('Moshe'), 'ciphertext only');
  assert.equal((await db.query('SELECT intake_status FROM client WHERE id = $1', [c.id])).rows[0].intake_status, 'paperwork_received');
  const list = await (await get(`/api/clients/${c.id}/intake`)).json();
  assert.equal(list.documents[0].filename, 'consent.pdf');
  const dl = await get(`/api/documents/${document_id}`);
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('content-disposition'), /^attachment/);
  assert.deepEqual(Buffer.from(await dl.arrayBuffer()), pdf);
  assert.equal((await fetch(`${base}/api/documents/${document_id}`)).status, 401);
});

test('upload does not move a client backwards, and bad files are refused', async () => {
  const c = await newClient();
  await db.query(`UPDATE client SET intake_status = 'ready' WHERE id = $1`, [c.id]);
  const ok = await (await upload(`/api/clients/${c.id}/documents`, 'x.pdf', 'pdf')).json();
  assert.equal(ok.status_advanced, false);
  assert.equal((await db.query('SELECT intake_status FROM client WHERE id = $1', [c.id])).rows[0].intake_status, 'ready');
  assert.equal((await upload(`/api/clients/${c.id}/documents`, 'run.exe', 'x')).status, 400);
  assert.equal((await upload(`/api/clients/${c.id}/documents`, 'empty.pdf', '')).status, 400);
  assert.equal((await upload(`/api/clients/${c.id}/intake/form`, 'f.csv', 'nonsense,here\r\n1,2')).status, 400);
  assert.equal((await upload(`/api/clients/00000000-0000-4000-8000-000000000000/documents`, 'x.pdf', 'pdf')).status, 404);
});

test('a form with no client creates one, fills it, and defaults location to the clinician', async () => {
  const csv = CSV.replace('Moshe,Levi', 'Yossi,Brenner');
  const res = await upload('/api/intake/form', 'new.csv', csv);
  assert.equal(res.status, 201);
  const out = await res.json();
  assert.equal(out.created, true);
  assert.equal(out.location_defaulted, true);
  const { rows: [c] } = await db.query('SELECT first_name, last_name, dob::text AS dob, intake_status, timezone, latitude::float AS lat FROM client WHERE id = $1', [out.client_id]);
  assert.deepEqual(c, { first_name: 'Yossi', last_name: 'Brenner', dob: '2019-03-14', intake_status: 'paperwork_received', timezone: 'America/New_York', lat: 40.6782 });
  assert.equal((await db.query('SELECT 1 FROM contact WHERE client_id = $1', [out.client_id])).rows.length, 1);
  assert.equal((await db.query('SELECT 1 FROM client_document WHERE client_id = $1', [out.client_id])).rows.length, 1);
});

test('creating from a form refuses duplicates and forms without a name', async () => {
  const dup = await upload('/api/intake/form', 'new.csv', CSV.replace('Moshe,Levi', 'yossi,BRENNER'));
  assert.equal(dup.status, 409);
  assert.ok((await dup.json()).client_id);
  assert.equal((await upload('/api/intake/form', 'n.json', JSON.stringify({ first_name: 'Only' }))).status, 400);
  assert.equal((await fetch(base + '/api/intake/form', { method: 'POST', headers: { 'X-Requested-With': 'totty' }, body: 'x' })).status, 401);
});

// ---- Fillable PDF (the standard intake form) ----
import { PDFDocument } from 'pdf-lib';

async function filledPdf(values) {
  const doc = await PDFDocument.load(await (await get('/api/intake/blank-form.pdf')).arrayBuffer());
  const form = doc.getForm();
  for (const [k, v] of Object.entries(values)) {
    const f = form.getField(k);
    if (f.constructor.name === 'PDFDropdown') f.select(v); else f.setText(v);
  }
  return Buffer.from(await doc.save());
}

const PDF_VALUES = {
  first_name: 'Dovid', last_name: 'Katz', dob: '5/2/2018', gender: 'Male', location: 'Monsey',
  parent1_name: 'Chana Katz', parent1_relationship: 'Mother', parent1_phone: '(845) 555-0100', parent1_email: 'chana@example.test',
  parent1_language: 'Yiddish', parent1_preferred_channel: 'Phone call', notes: 'Afraid of dogs',
};

test('the blank PDF form downloads and is fillable', async () => {
  const res = await get('/api/intake/blank-form.pdf');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.ok((await PDFDocument.load(await res.arrayBuffer())).getForm().getFields().length > 15);
});

test('a filled PDF creates a pre-filled client', async () => {
  const res = await upload('/api/intake/form', 'intake-form.pdf', await filledPdf(PDF_VALUES));
  assert.equal(res.status, 201, await res.clone().text());
  const out = await res.json();
  assert.deepEqual(out.warnings, []);
  const { rows: [c] } = await db.query('SELECT first_name, last_name, dob::text AS dob, gender, location_name, notes, intake_status FROM client WHERE id = $1', [out.client_id]);
  assert.deepEqual(c, { first_name: 'Dovid', last_name: 'Katz', dob: '2018-05-02', gender: 'Male', location_name: 'Monsey', notes: 'Afraid of dogs', intake_status: 'paperwork_received' });
  const { rows: [p] } = await db.query('SELECT name, relationship, phone, email, language, preferred_channel FROM contact WHERE client_id = $1', [out.client_id]);
  assert.deepEqual(p, { name: 'Chana Katz', relationship: 'Mother', phone: '+18455550100', email: 'chana@example.test', language: 'yi', preferred_channel: 'call' });
});

test('a PDF with no fillable fields, or not a PDF, is rejected with a clear message', async () => {
  const flat = await PDFDocument.create(); flat.addPage();
  const r1 = await upload('/api/intake/parse', 'scan.pdf', Buffer.from(await flat.save()));
  assert.equal(r1.status, 400);
  assert.match((await r1.json()).error, /no fillable fields/);
  const r2 = await upload('/api/intake/parse', 'bad.pdf', Buffer.from('not a pdf'));
  assert.equal(r2.status, 400);
});
