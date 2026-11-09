import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb, makeEnv, seedWorld, PASSWORD } from './helpers.js';
import { createApp } from '../src/app.js';

let db, env, world, server, base;
const SECRET = 'x'.repeat(40);

before(async () => {
  db = await makeDb();
  env = makeEnv(db, '2026-11-04T15:00:00Z'); // Wednesday 10am EST
  world = await seedWorld(db);
  const app = createApp({ db, messenger: env.messenger, now: env.now, config: { sessionSecret: SECRET, production: false } });
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function call(path, { method = 'GET', body, cookie, form } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'X-Requested-With': 'totty',
      ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : { 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: method === 'GET' ? undefined : form ? new URLSearchParams(form).toString() : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* xml or empty */ }
  return { status: res.status, json, text, cookie: res.headers.get('set-cookie')?.split(';')[0] };
}
const login = async (email = 'totty@example.test', password = PASSWORD) => (await call('/api/login', { method: 'POST', body: { email, password } }));

test('API requires a login', async () => {
  assert.equal((await call('/api/dashboard')).status, 401);
  assert.equal((await call('/api/clients')).status, 401);
});

test('login rejects a wrong password and sets an HttpOnly cookie on success', async () => {
  assert.equal((await login('totty@example.test', 'wrong password!!')).status, 401);
  const ok = await login();
  assert.equal(ok.status, 200);
  assert.ok(ok.cookie?.startsWith('totty_session='));
});

test('forged or tampered session cookies are rejected', async () => {
  const { cookie } = await login();
  assert.equal((await call('/api/dashboard', { cookie: cookie.slice(0, -3) + 'abc' })).status, 401);
  assert.equal((await call('/api/dashboard', { cookie: 'totty_session=e30.e30' })).status, 401);
});

test('state-changing requests need the X-Requested-With header', async () => {
  const { cookie } = await login();
  const res = await fetch(`${base}/api/clients`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: '{}' });
  assert.equal(res.status, 403);
});

test('creating a client requires an admission date and a location', async () => {
  const { cookie } = await login();
  const r = await call('/api/clients', { method: 'POST', cookie, body: { first_name: 'A', last_name: 'B', timezone: 'America/New_York', latitude: 40, longitude: -74 } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /admission_date/);
  const bad = await call('/api/clients', { method: 'POST', cookie, body: { first_name: 'A', last_name: 'B', admission_date: '2026-10-01', timezone: 'Mars/Base', latitude: 40, longitude: -74 } });
  assert.equal(bad.status, 400);
});

test('client, contact, goal and incentive round trip; dashboard shows incentives on the card', async () => {
  const { cookie } = await login();
  const c = await call('/api/clients', { method: 'POST', cookie, body: { first_name: 'Miri', last_name: 'Adler', admission_date: '2026-10-01', timezone: 'America/New_York', latitude: 40.6, longitude: -73.9 } });
  assert.equal(c.status, 201);
  const id = c.json.id;
  const contact = await call(`/api/clients/${id}/contacts`, { method: 'POST', cookie, body: { name: 'Mrs. Adler', phone: '+15555550111' } });
  assert.equal(contact.status, 201);
  const goal = await call(`/api/clients/${id}/goals`, { method: 'POST', cookie, body: { contact_id: contact.json.id, title: 'Waves hello', response_type: 'yes_no', channel: 'sms', schedule_json: { days: [1, 3], time: '17:00' }, start_date: '2026-10-05' } });
  assert.equal(goal.status, 201);
  const badGoal = await call(`/api/clients/${id}/goals`, { method: 'POST', cookie, body: { contact_id: contact.json.id, title: 'x', response_type: 'both', channel: 'sms', schedule_json: { days: [9], time: '25:00' }, start_date: '2026-10-05' } });
  assert.equal(badGoal.status, 400);
  assert.equal((await call(`/api/clients/${id}/incentives`, { method: 'POST', cookie, body: { name: 'bubbles' } })).status, 201);

  const dash = await call('/api/dashboard', { cookie });
  const card = dash.json.clients.find((x) => x.id === id);
  assert.deepEqual(card.incentives.map((i) => i.name), ['bubbles']);

  const detail = await call(`/api/clients/${id}`, { cookie });
  assert.equal(detail.json.goals.length, 1);
  assert.equal(detail.json.contacts.length, 1);
});

test('archiving removes a client from the dashboard', async () => {
  const { cookie } = await login();
  const c = await call('/api/clients', { method: 'POST', cookie, body: { first_name: 'Temp', last_name: 'Zed', admission_date: '2026-10-01', timezone: 'America/New_York', latitude: 40.6, longitude: -73.9 } });
  await call(`/api/clients/${c.json.id}/archive`, { method: 'POST', cookie, body: {} });
  const dash = await call('/api/dashboard', { cookie });
  assert.ok(!dash.json.clients.some((x) => x.id === c.json.id));
});

test("one clinician cannot read or change another's data", async () => {
  const other = await seedWorld(db, { email: 'other@example.test' });
  const { cookie } = await login();
  assert.equal((await call(`/api/clients/${other.client.id}`, { cookie })).status, 404);
  assert.equal((await call(`/api/clients/${other.client.id}`, { method: 'PATCH', cookie, body: { notes: 'x' } })).status, 404);
  assert.equal((await call(`/api/clients/${other.client.id}/incentives`, { method: 'POST', cookie, body: { name: 'x' } })).status, 404);
  assert.equal((await call('/api/clients/not-a-uuid', { cookie })).status, 404);
});

test('PATCH ignores unknown fields instead of letting them reach SQL', async () => {
  const { cookie } = await login();
  const r = await call(`/api/clients/${world.client.id}`, { method: 'PATCH', cookie, body: { 'notes = 1; DROP TABLE client; --': 'x' } });
  assert.equal(r.status, 400); // nothing allowed to update
  assert.equal((await call(`/api/clients/${world.client.id}`, { cookie })).status, 200);
});

test('manual data entry and resolving an unparsed reply need an audit note', async () => {
  const { cookie } = await login();
  const goal = await world.addGoal('Bedtime', { type: 'rating' });
  const p = await world.one(`INSERT INTO prompt (goal_id, scheduled_for, prompt_date, channel, status) VALUES ($1, now(), current_date, 'sms', 'no_response') RETURNING id`, [goal.id]);
  assert.equal((await call(`/api/prompts/${p.id}/response`, { method: 'POST', cookie, body: { value_int: 4 } })).status, 400);
  assert.equal((await call(`/api/prompts/${p.id}/response`, { method: 'POST', cookie, body: { value_int: 9, audit_note: 'phone' } })).status, 400);
  const ok = await call(`/api/prompts/${p.id}/response`, { method: 'POST', cookie, body: { value_int: 4, audit_note: 'Mom told me by phone' } });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.source, 'manual');

  const u = await world.one(`INSERT INTO response (prompt_id, raw_text, source, parse_status) VALUES ($1, 'huh', 'sms', 'unparsed') RETURNING id`, [p.id]);
  const dash = await call('/api/dashboard', { cookie });
  assert.ok(dash.json.unparsed.some((x) => x.id === u.id));
  const fixed = await call(`/api/responses/${u.id}`, { method: 'PATCH', cookie, body: { value_int: 2, audit_note: 'reviewed' } });
  assert.equal(fixed.json.parse_status, 'reviewed');
  assert.ok(!(await call('/api/dashboard', { cookie })).json.unparsed.some((x) => x.id === u.id));
});

test('dashboard flags a client with missed responses and shows the next Shabbos window', async () => {
  const { cookie } = await login();
  const g = await world.addGoal('Missed goal');
  for (let i = 1; i <= 3; i++) {
    await db.query(`INSERT INTO prompt (goal_id, scheduled_for, prompt_date, channel, status) VALUES ($1, $2, $3, 'sms', 'no_response')`,
      [g.id, `2026-11-0${i}T23:30:00Z`, `2026-11-0${i}`]);
  }
  const d = (await call('/api/dashboard', { cookie })).json;
  assert.ok(d.attention.some((c) => c.id === world.client.id));
  assert.equal(d.shabbos.active, false);
  assert.equal(d.shabbos.start.slice(0, 10), '2026-11-06');
});

test('AC9: during Shabbos login and every action are refused with the reopen time', async () => {
  const { cookie } = await login(); // logged in Wednesday
  env.at('2026-11-06T21:35:00Z'); // Friday, just after candle lighting
  try {
    for (const [path, method] of [['/api/dashboard', 'GET'], ['/api/clients', 'POST'], ['/api/login', 'POST'], ['/api/logout', 'POST']]) {
      const r = await call(path, { method, cookie, body: { email: 'totty@example.test', password: PASSWORD } });
      assert.equal(r.status, 423, path);
      assert.equal(r.json.error, 'shabbos');
      // Totty's own lock uses his location (Brooklyn), a couple of minutes off Lakewood's nightfall
      assert.equal(r.json.reopensAt.slice(0, 16), '2026-11-07T22:57');
    }
    const status = await call('/api/status', { cookie });
    assert.equal(status.status, 200);
    assert.equal(status.json.locked, true);
  } finally {
    env.at('2026-11-04T15:00:00Z');
  }
});

test('AC9: a parent reply arriving during Shabbos is still recorded through the webhook', async () => {
  const goal = await world.addGoal('Spoon');
  await world.one(`INSERT INTO prompt (goal_id, scheduled_for, prompt_date, short_code, sent_at, channel, status) VALUES ($1, '2026-11-06T20:00:00Z', '2026-11-06', 1, '2026-11-06T20:00:00Z', 'sms', 'sent') RETURNING id`, [goal.id]);
  env.at('2026-11-07T15:00:00Z');
  try {
    const r = await call('/webhooks/twilio/sms', { method: 'POST', form: { From: '+15555550100', Body: 'Y', MessageSid: 'SMxyz' } });
    assert.equal(r.status, 200);
    assert.equal(r.text, '<Response/>');
    const { rows } = await db.query(`SELECT r.value_bool FROM response r JOIN prompt p ON p.id = r.prompt_id WHERE p.goal_id = $1`, [goal.id]);
    assert.deepEqual(rows, [{ value_bool: true }]);
  } finally {
    env.at('2026-11-04T15:00:00Z');
  }
});

test('webhook refuses unsigned requests in production', async () => {
  const app = createApp({ db, messenger: env.messenger, now: env.now, config: { sessionSecret: SECRET, production: true, twilio: null } });
  const s = app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${s.address().port}/webhooks/twilio/sms`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'From=%2B15555550100&Body=Y' });
    assert.equal(res.status, 503);
  } finally {
    s.close();
  }
});

test('static dashboard is served', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Totty's ABA/);
});

test('goal series: missing replies are not counted as No; trend and annotations are returned', async () => {
  const { cookie } = await login();
  const g = await world.addGoal('Series goal');
  let i = 0;
  for (const v of [false, false, true, true, null, true, true, true]) {
    const day = `2026-10-${String(10 + i++).padStart(2, '0')}`;
    const p = await world.one(
      `INSERT INTO prompt (goal_id, scheduled_for, prompt_date, channel, status) VALUES ($1, $2, $3, 'sms', $4) RETURNING id`,
      [g.id, `${day}T22:30:00Z`, day, v === null ? 'no_response' : 'answered'],
    );
    if (v !== null) await db.query(`INSERT INTO response (prompt_id, value_bool, source) VALUES ($1, $2, 'sms')`, [p.id, v]);
  }
  const a = await call(`/api/goals/${g.id}/annotations`, { method: 'POST', cookie, body: { date: '2026-10-14', text: 'new intervention' } });
  assert.equal(a.status, 201);
  assert.equal((await call(`/api/goals/${g.id}/annotations`, { method: 'POST', cookie, body: { date: 'nope', text: 'x' } })).status, 400);
  const s = await call(`/api/goals/${g.id}/series?range=all`, { cookie });
  assert.equal(s.status, 200);
  assert.equal(s.json.points.length, 8);
  const missing = s.json.points.find((p) => p.status === 'no_response');
  assert.equal(missing.answered, false);
  assert.equal(missing.value_bool, null);
  assert.equal(s.json.trend, 'improving');
  assert.equal(s.json.annotations[0].text, 'new intervention');
});

test("another clinician's goal series and annotations are 404", async () => {
  const other = await seedWorld(db, { email: 'third@example.test' });
  const g = await other.addGoal('Private');
  const { cookie } = await login();
  assert.equal((await call(`/api/goals/${g.id}/series`, { cookie })).status, 404);
  assert.equal((await call(`/api/goals/${g.id}/annotations`, { method: 'POST', cookie, body: { date: '2026-10-01', text: 'x' } })).status, 404);
});
