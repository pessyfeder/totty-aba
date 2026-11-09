import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeDb, makeEnv, seedWorld, PASSWORD } from './helpers.js';
import { createApp } from '../src/app.js';
import { checkPeriod, lastCompletedWeek } from '../src/reports.js';

let db, env, world, server, base, dir, cookie, goal, quiet;
const WEEK = { period_type: 'weekly', period_start: '2026-10-25', period_end: '2026-10-31' };

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'reports-'));
  db = await makeDb();
  env = makeEnv(db, '2026-11-04T15:00:00Z'); // Wednesday 10am EST
  world = await seedWorld(db);
  const app = createApp({ db, messenger: env.messenger, now: env.now, config: { sessionSecret: 'y'.repeat(40), production: false, publicUrl: 'https://app.example.test', reportsDir: dir } });
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  cookie = (await call('/api/login', { method: 'POST', body: { email: 'totty@example.test', password: PASSWORD } })).cookie;

  goal = await world.addGoal('Uses a spoon');
  quiet = await world.addGoal('No replies yet goal'); // active goal with no prompts at all
  const days = ['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28'];
  const vals = [true, false, null, true]; // null = no reply, which must not count as No
  for (const [i, d] of days.entries()) {
    const p = await world.one(
      `INSERT INTO prompt (goal_id, scheduled_for, prompt_date, channel, status) VALUES ($1, $2, $3, 'sms', $4) RETURNING id`,
      [goal.id, `${d}T22:30:00Z`, d, vals[i] === null ? 'no_response' : 'answered'],
    );
    if (vals[i] !== null) await db.query(`INSERT INTO response (prompt_id, value_bool, comment, source) VALUES ($1, $2, $3, 'sms')`, [p.id, vals[i], i === 1 ? 'tough day' : null]);
  }
});
after(async () => { server.close(); await rm(dir, { recursive: true, force: true }); });

async function call(p, { method = 'GET', body } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: { 'X-Requested-With': 'totty', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: method === 'GET' ? undefined : body ? JSON.stringify(body) : undefined,
  });
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null;
  try { json = JSON.parse(buf.toString()); } catch { /* binary or text */ }
  return { status: res.status, json, buf, type: res.headers.get('content-type'), cookie: res.headers.get('set-cookie')?.split(';')[0] };
}

test('period rules: weekly is Sunday-Saturday, monthly is a whole month, default is the last completed week', () => {
  assert.ok(checkPeriod('weekly', '2026-10-25', '2026-10-31'));
  assert.throws(() => checkPeriod('weekly', '2026-10-26', '2026-11-01'), /Sunday/);
  assert.ok(checkPeriod('monthly', '2026-10-01', '2026-10-31'));
  assert.throws(() => checkPeriod('monthly', '2026-10-05', '2026-10-31'), /month/);
  assert.ok(checkPeriod('custom', '2026-10-03', '2026-10-09'));
  assert.throws(() => checkPeriod('custom', '2026-10-09', '2026-10-03'), /before/);
  assert.deepEqual(lastCompletedWeek('2026-11-04'), { start: '2026-10-25', end: '2026-10-31' });
  assert.deepEqual(lastCompletedWeek('2026-11-07'), { start: '2026-10-25', end: '2026-10-31' }); // Saturday is not complete yet
});

test('history endpoint suggests the last completed week; nothing is created until Create is clicked', async () => {
  const r = await call(`/api/clients/${world.client.id}/reports`);
  assert.deepEqual(r.json.reports, []);
  assert.deepEqual(r.json.default_period, { period_type: 'weekly', start: '2026-10-25', end: '2026-10-31' });
});

test('a created report includes every active goal; no reply is not counted as No', async () => {
  const c = await call(`/api/clients/${world.client.id}/reports`, { method: 'POST', body: WEEK });
  assert.equal(c.status, 201);
  const r = (await call(`/api/reports/${c.json.id}`)).json;
  assert.equal(r.status, 'draft');
  const titles = r.content.goals.map((g) => g.title).sort();
  assert.deepEqual(titles, ['No replies yet goal', 'Uses a spoon']);
  const g = r.content.goals.find((x) => x.title === 'Uses a spoon');
  assert.equal(g.asked, 4);
  assert.equal(g.received, 3);
  assert.equal(g.metric, 67); // 2 yes of 3 answered, the missed day is excluded
  assert.deepEqual(g.comments.map((x) => x.text), ['tough day']);
  assert.equal(r.content.goals.find((x) => x.title === 'No replies yet goal').metric, null);
  assert.equal((await call(`/api/clients/${world.client.id}/reports`, { method: 'POST', body: { ...WEEK, period_start: '2026-10-26' } })).status, 400);
});

test('draft can be edited, downloaded as PDF; sending needs consent, then freezes it and texts only a link', async () => {
  const id = (await call(`/api/clients/${world.client.id}/reports`, { method: 'POST', body: WEEK })).json.id;
  const gid = (await call(`/api/reports/${id}`)).json.content.goals.find((x) => x.title === 'Uses a spoon').goal_id;
  const patch = await call(`/api/reports/${id}`, { method: 'PATCH', body: { note: 'Great week!', next_focus: 'Cup drinking', goals: { [gid]: { remark: 'Improving', exclude_comments: [0] } } } });
  assert.equal(patch.status, 200);
  assert.equal(patch.json.content.goals.find((x) => x.goal_id === gid).comments[0].include, false);

  const pdf = await call(`/api/reports/${id}/pdf`);
  assert.equal(pdf.type, 'application/pdf');
  assert.equal(pdf.buf.subarray(0, 4).toString(), '%PDF');

  // No consent recorded yet
  assert.equal((await call(`/api/reports/${id}/send`, { method: 'POST', body: { contact_id: world.contact.id } })).status, 400);
  await db.query('UPDATE contact SET consent_given_at = now() WHERE id = $1', [world.contact.id]);
  const before = env.sent.length;
  const send = await call(`/api/reports/${id}/send`, { method: 'POST', body: { contact_id: world.contact.id } });
  assert.equal(send.status, 200);
  assert.equal(env.sent.length, before + 1);
  const sms = env.sent.at(-1);
  assert.equal(sms.to, '+15555550100');
  assert.match(sms.body, /^A progress report for Dovid is ready: https:\/\/app\.example\.test\/r\/[\w-]{40,}$/);
  assert.doesNotMatch(sms.body, /%|spoon|Cohen/i); // no progress details or last name in the text

  // Frozen after sending
  assert.equal((await call(`/api/reports/${id}`, { method: 'PATCH', body: { note: 'x' } })).status, 409);
  assert.equal((await call(`/api/reports/${id}/send`, { method: 'POST', body: { contact_id: world.contact.id } })).status, 409);
  const row = (await db.query('SELECT status, link_token_hash, pdf_path FROM report WHERE id = $1', [id])).rows[0];
  assert.equal(row.status, 'sent');
  assert.notEqual(row.link_token_hash, sms.body.split('/r/')[1]); // only a hash is stored

  // The parent's link works without a login, then expires after 14 days
  const token = sms.body.split('/r/')[1];
  const open = await fetch(`${base}/r/${token}`);
  assert.equal(open.status, 200);
  assert.equal(open.headers.get('content-type'), 'application/pdf');
  assert.equal((await fetch(`${base}/r/${'a'.repeat(43)}`)).status, 404);
  env.at('2026-11-19T15:00:00Z'); // 15 days later
  assert.equal((await fetch(`${base}/r/${token}`)).status, 404);
  env.at('2026-11-04T15:00:00Z');
});

test('the history lists reports; another clinician cannot see them', async () => {
  const h = (await call(`/api/clients/${world.client.id}/reports`)).json.reports;
  assert.ok(h.length >= 2);
  assert.ok(h.some((r) => r.status === 'sent'));
  const other = await seedWorld(db, { email: 'other@example.test' });
  assert.equal((await call(`/api/clients/${other.client.id}/reports`)).status, 404);
  const rid = (await db.query(`INSERT INTO report (client_id, period_type, period_start, period_end, content_json) VALUES ($1, 'custom', '2026-10-01', '2026-10-02', '{}') RETURNING id`, [other.client.id])).rows[0].id;
  assert.equal((await call(`/api/reports/${rid}`)).status, 404);
});

test('Create and Send are refused during Shabbos, and a refused send leaves the report a draft', async () => {
  const id = (await call(`/api/clients/${world.client.id}/reports`, { method: 'POST', body: WEEK })).json.id;
  env.at('2026-11-07T15:00:00Z'); // Saturday 10am EST
  const n = env.sent.length;
  const create = await call(`/api/clients/${world.client.id}/reports`, { method: 'POST', body: WEEK });
  assert.equal(create.status, 423);
  const send = await call(`/api/reports/${id}/send`, { method: 'POST', body: { contact_id: world.contact.id } });
  assert.equal(send.status, 423);
  assert.equal(env.sent.length, n);
  env.at('2026-11-04T15:00:00Z');
  assert.equal((await db.query('SELECT status FROM report WHERE id = $1', [id])).rows[0].status, 'draft');
});

test('the messenger itself refuses a report send inside the window and logs it', async () => {
  const id = (await call(`/api/clients/${world.client.id}/reports`, { method: 'POST', body: WEEK })).json.id;
  env.at('2026-11-07T15:00:00Z');
  const client = (await db.query('SELECT * FROM client WHERE id = $1', [world.client.id])).rows[0];
  await assert.rejects(env.messenger.send({ client, settings: world.clinician.settings_json, to: '+15555550100', body: 'x', reportId: id }), /refused/);
  env.at('2026-11-04T15:00:00Z');
  const log = (await db.query(`SELECT status FROM message_log WHERE report_id = $1`, [id])).rows;
  assert.deepEqual(log.map((l) => l.status), ['refused']);
});
