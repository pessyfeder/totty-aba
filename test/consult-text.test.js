import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb, makeEnv, seedWorld, PASSWORD } from './helpers.js';
import { createApp } from '../src/app.js';
import { approve, buildConsultText, preview, sendApproved } from '../src/consult-text.js';
import { textStatus } from '../src/text-status.js';

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
  await fetch(`${base}/api/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'totty', Cookie: cookie }, body: JSON.stringify({ consult_booking_url: LINK }) });
});
after(() => server.close());

const call = (method, path, body) => fetch(base + path, {
  method,
  headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'totty', Cookie: cookie },
  body: body ? JSON.stringify(body) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

async function newClient(first, { phone = '+15555550123', consent = true, status = 'inquiry' } = {}) {
  const { rows: [c] } = await db.query(
    `INSERT INTO client (clinician_id, first_name, last_name, admission_date, latitude, longitude, timezone, intake_status)
     VALUES ($1, $2, 'Levi', '2026-11-01', 40.0979, -74.2176, 'America/New_York', $3) RETURNING *`, [world.clinician.id, first, status]);
  await db.query(`INSERT INTO contact (client_id, name, phone, consent_given_at) VALUES ($1, 'Rivka Levi', $2, $3)`, [c.id, phone || null, consent ? new Date('2026-11-01') : null]);
  return c;
}
const setStatus = (id, s) => call('POST', `/api/clients/${id}/intake-status`, { intake_status: s });
const textOf = (id) => call('GET', `/api/clients/${id}/consult-text`);
const consultTexts = () => env.sent.filter((m) => m.body.includes('Book the consultation'));

test('the text is plain: the child\'s first name and the link only', () => {
  const t = buildConsultText({ client: { first_name: 'Moshe', last_name: 'Levi' }, link: LINK });
  assert.equal(t, `Thank you, the information for Moshe has been successfully submitted. Book the consultation with Yisroel Feder, BCBA, LBA: ${LINK}`);
  assert.ok(!t.includes('Levi'));
});

test('no draft before information is submitted; reaching that status drafts one, waiting for approval, and sends nothing', async () => {
  const c = await newClient('Moshe');
  assert.equal((await textOf(c.id)).json, null);
  await setStatus(c.id, 'paperwork_received');
  const t = (await textOf(c.id)).json;
  assert.equal(t.status, 'pending_approval');
  assert.equal(t.to, '+15555550123');
  assert.equal(t.text, buildConsultText({ client: c, link: LINK }));
  assert.deepEqual(t.problems, []);
  assert.equal(consultTexts().length, 0);
  // The email draft is made too: the text goes alongside it, not instead of it.
  assert.equal((await call('GET', `/api/clients/${c.id}/consult-email`)).json.status, 'pending_approval');
});

test('approval sends once and only once; declining stops it', async () => {
  const c = await newClient('Yosef');
  await setStatus(c.id, 'paperwork_received');
  const ok = await call('POST', `/api/clients/${c.id}/consult-text/approve`);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.status, 'sent');
  assert.equal(consultTexts().length, 1);
  assert.equal(env.sent.at(-1).to, '+15555550123');
  assert.equal((await call('POST', `/api/clients/${c.id}/consult-text/approve`)).status, 400);
  await sendApproved({ db, messenger: env.messenger, now: env.now });
  assert.equal(consultTexts().length, 1);
  await setStatus(c.id, 'baseline');
  await setStatus(c.id, 'paperwork_received'); // re-reaching the status makes no second draft
  assert.equal((await textOf(c.id)).json.status, 'sent');

  const d = await newClient('Avrumi');
  await setStatus(d.id, 'paperwork_received');
  assert.equal((await call('POST', `/api/clients/${d.id}/consult-text/cancel`)).json.status, 'cancelled');
  assert.equal((await call('POST', `/api/clients/${d.id}/consult-text/approve`)).status, 400);
  assert.equal(consultTexts().length, 1);
});

test('no recorded consent, or no number: a warning, approval refused, nothing sent', async () => {
  const c = await newClient('Dovid2', { consent: false });
  await setStatus(c.id, 'paperwork_received');
  const t = (await textOf(c.id)).json;
  assert.match(t.problems[0], /consent/i);
  const n = env.sent.length;
  assert.equal((await call('POST', `/api/clients/${c.id}/consult-text/approve`)).status, 400);
  await sendApproved({ db, messenger: env.messenger, now: env.now });
  assert.equal(env.sent.length, n);
  const s = (await call('GET', `/api/clients/${c.id}/text-status`)).json;
  assert.ok(s.reasons.some((r) => /No text consent is recorded for Rivka Levi/.test(r)));
  assert.equal(s.consult.label, 'Needs approval');
  // Once consent is recorded it can go.
  await db.query(`UPDATE contact SET consent_given_at = now() WHERE client_id = $1`, [c.id]);
  assert.equal((await call('POST', `/api/clients/${c.id}/consult-text/approve`)).json.status, 'sent');

  const d = await newClient('Nophone', { phone: '' });
  await setStatus(d.id, 'paperwork_received');
  assert.match((await textOf(d.id)).json.problems[0], /mobile number/);
});

test('an approved text is queued through Shabbos and sent after nightfall', async () => {
  const c = await newClient('Shmuel');
  await setStatus(c.id, 'paperwork_received');
  await approve(db, c.id); // approved, not yet sent
  const n = consultTexts().length;
  env.at('2026-11-07T15:00:00Z'); // Shabbos afternoon
  assert.deepEqual(await sendApproved({ db, messenger: env.messenger, now: env.now }), []);
  assert.equal(consultTexts().length, n);
  const queued = await preview(db, c.id, env.now); // the API itself is locked during Shabbos
  assert.equal(queued.status, 'approved');
  assert.ok(queued.queued_until);
  env.at('2026-11-08T14:00:00Z'); // Sunday
  assert.deepEqual(await sendApproved({ db, messenger: env.messenger, now: env.now }), [c.id]);
  assert.equal(consultTexts().length, n + 1);
  env.at('2026-11-04T15:00:00Z');
});

test('a failing send retries then gives up and says why; a moved-on or archived client is not texted', async () => {
  const c = await newClient('Berel');
  await setStatus(c.id, 'paperwork_received');
  await approve(db, c.id);
  const boom = { async send() { throw new Error('carrier down'); } };
  for (let i = 0; i < 3; i++) {
    assert.equal((await textOf(c.id)).json.status, 'approved'); // still retrying until the third failure
    await sendApproved({ db, messenger: boom, now: env.now });
    if (i === 0) { // too soon: the retry waits 30 minutes
      const calls = []; const spy = { async send(m) { calls.push(m); throw new Error('carrier down'); } };
      env.at('2026-11-04T15:29:00Z');
      await sendApproved({ db, messenger: spy, now: env.now });
      assert.equal(calls.length, 0);
    }
    env.at(`2026-11-04T${15 + i + 1}:00:00Z`); // an hour or more later: due again
  }
  env.at('2026-11-04T15:00:00Z');
  const t = (await textOf(c.id)).json;
  assert.equal(t.status, 'failed');
  assert.match(t.last_error, /carrier down/);

  const d = await newClient('Zalman');
  await setStatus(d.id, 'paperwork_received');
  await approve(db, d.id);
  await setStatus(d.id, 'baseline'); // consult booked by other means
  const e = await newClient('Archie');
  await setStatus(e.id, 'paperwork_received');
  await approve(db, e.id);
  await call('POST', `/api/clients/${e.id}/archive`, {});
  const n = env.sent.length;
  await sendApproved({ db, messenger: env.messenger, now: env.now });
  assert.equal(env.sent.length, n);
  assert.equal((await textOf(d.id)).json.status, 'cancelled');
  assert.equal((await textOf(e.id)).json.status, 'cancelled');
});

test('the status summary explains why texts cannot go out, and is private to the owning clinician', async () => {
  const c = await newClient('Paused');
  await db.query(`UPDATE contact SET status = 'paused' WHERE client_id = $1`, [c.id]);
  let s = (await call('GET', `/api/clients/${c.id}/text-status`)).json;
  assert.ok(s.reasons.some((r) => /paused/.test(r)));
  await call('POST', `/api/clients/${c.id}/archive`, {});
  s = (await call('GET', `/api/clients/${c.id}/text-status`)).json;
  assert.ok(s.reasons.some((r) => /archived/.test(r)));

  s = await textStatus(db, world.client.id, new Date('2026-11-07T15:00:00Z')); // Shabbos afternoon
  assert.ok(s.shabbos && s.reasons.some((r) => /Shabbos/.test(r)));

  const { rows: [other] } = await db.query(`INSERT INTO clinician (name, email, password_hash, timezone, latitude, longitude) VALUES ('X', 'x2@example.test', 'x', 'America/New_York', 40, -74) RETURNING id`);
  const { rows: [theirs] } = await db.query(
    `INSERT INTO client (clinician_id, first_name, last_name, admission_date, latitude, longitude, timezone, intake_status) VALUES ($1, 'A', 'B', '2026-11-01', 40, -74, 'America/New_York', 'paperwork_received') RETURNING id`, [other.id]);
  assert.equal((await call('GET', `/api/clients/${theirs.id}/text-status`)).status, 404);
  assert.equal((await call('POST', `/api/clients/${theirs.id}/consult-text/approve`)).status, 404);
});
