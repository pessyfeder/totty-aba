// Weekly check-in EMAIL for paper-log contacts (SPEC 5.4b C, 5.7a).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb, makeEnv, seedWorld } from './helpers.js';
import { createScheduler } from '../src/scheduler.js';

const LINK = 'https://calendar.google.com/book/checkin';
let db, env, world, scheduler;

beforeEach(async () => {
  db = await makeDb();
  env = makeEnv(db, '2026-11-04T23:31:00Z'); // Wed 6:31pm EST
  world = await seedWorld(db);
  await db.query(`UPDATE contact SET consent_given_at = now(), email = 'mrs@example.test', logging_method = 'paper' WHERE id = $1`, [world.contact.id]);
  await db.query(`UPDATE client SET intake_status = 'baseline', baseline_started_at = '2026-11-04T15:00:00Z' WHERE id = $1`, [world.client.id]);
  await db.query(`UPDATE contact SET logging_method_changed_at = '2026-11-01T00:00:00Z' WHERE id = $1`, [world.contact.id]);
  await db.query(`UPDATE clinician SET settings_json = jsonb_set(settings_json, '{checkin_booking_url}', to_jsonb($1::text))`, [LINK]);
  scheduler = createScheduler({ db, messenger: env.messenger, mailer: env.mailer, now: env.now, staggerMs: 0 });
});

const contact = async () => (await db.query('SELECT * FROM contact WHERE id = $1', [world.contact.id])).rows[0];
const run = (iso) => { env.at(iso); return scheduler.tick(); };

test('nothing is sent before 7 days after baseline starts; no goal prompts or texts ever', async () => {
  await world.addGoal('Uses a spoon');
  await run('2026-11-10T23:00:00Z'); // 6 days later
  assert.equal(env.mails.length, 0);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM prompt')).rows[0].n, 0, 'no prompts for a paper contact');
  await run('2026-11-12T00:00:00Z'); // Wed 7pm EST, 7 days + 9h after baseline
  assert.equal(env.mails.length, 1);
  assert.equal(env.sent.length, 0, 'no text for a paper contact');
});

test('the email always carries the booking link, first name only, and is logged', async () => {
  await run('2026-11-12T00:00:00Z');
  const [m] = env.mails;
  assert.equal(m.to, 'mrs@example.test');
  assert.match(m.subject, /Dovid/);
  assert.ok(m.text.includes(LINK));
  assert.ok(!/reach out/i.test(m.text));
  const log = (await db.query(`SELECT * FROM message_log WHERE to_from = 'mrs@example.test'`)).rows;
  assert.equal(log.length, 1);
});

test('then every 7 days from the last one, and not twice in a tick', async () => {
  await run('2026-11-12T00:00:00Z');
  await run('2026-11-12T00:01:00Z');
  assert.equal(env.mails.length, 1);
  await run('2026-11-18T23:00:00Z'); // under 7 days
  assert.equal(env.mails.length, 1);
  await run('2026-11-19T00:01:00Z');
  assert.equal(env.mails.length, 2);
});

test('a switch to paper after baseline restarts the 7 days', async () => {
  await db.query(`UPDATE contact SET logging_method_changed_at = '2026-11-10T12:00:00Z' WHERE id = $1`, [world.contact.id]);
  await run('2026-11-12T00:00:00Z');
  assert.equal(env.mails.length, 0);
  await run('2026-11-17T23:00:00Z');
  assert.equal(env.mails.length, 1);
});

test('changing the method stamps logging_method_changed_at', async () => {
  await db.query(`UPDATE contact SET logging_method_changed_at = NULL WHERE id = $1`, [world.contact.id]);
  await db.query(`UPDATE contact SET name = 'X' WHERE id = $1`, [world.contact.id]);
  assert.equal((await contact()).logging_method_changed_at, null);
  await db.query(`UPDATE contact SET logging_method = 'sms' WHERE id = $1`, [world.contact.id]);
  assert.ok((await contact()).logging_method_changed_at);
});

test('needs an email, recorded consent, an active contact and the booking link', async () => {
  for (const sql of [
    `UPDATE contact SET email = NULL`, `UPDATE contact SET consent_given_at = NULL`, `UPDATE contact SET status = 'paused'`,
    `UPDATE clinician SET settings_json = settings_json - 'checkin_booking_url'`,
  ]) {
    await db.query(sql);
    await run('2026-11-12T00:00:00Z');
    assert.equal(env.mails.length, 0, sql);
    await db.query(`UPDATE contact SET email = 'mrs@example.test', consent_given_at = now(), status = 'active'`);
    await db.query(`UPDATE clinician SET settings_json = jsonb_set(settings_json, '{checkin_booking_url}', to_jsonb($1::text))`, [LINK]);
  }
});

test('not during Shabbos or quiet hours: sent afterwards, not dropped', async () => {
  await run('2026-11-14T17:00:00Z'); // Shabbos
  assert.equal(env.mails.length, 0);
  await run('2026-11-12T07:00:00Z'); // 2am EST, quiet hours
  assert.equal(env.mails.length, 0);
  await run('2026-11-15T17:00:00Z'); // Sunday noon
  assert.equal(env.mails.length, 1);
});

test('skipped, clock not advanced, while an appointment is booked', async () => {
  await db.query(
    `INSERT INTO appointment (clinician_id, client_id, external_id, type, starts_at, ends_at) VALUES ($1, $2, 'p1', 'check-in', '2026-11-13T15:00:00Z', '2026-11-13T16:00:00Z')`,
    [world.clinician.id, world.client.id]);
  await run('2026-11-12T00:00:00Z');
  assert.equal(env.mails.length, 0);
  assert.equal((await contact()).checkin_last_sent_at, null);
  await run('2026-11-15T17:00:00Z');
  assert.equal(env.mails.length, 1);
});

test('a failed send does not advance the clock', async () => {
  const failing = createScheduler({ db, messenger: env.messenger, mailer: { async send() { throw new Error('smtp down'); } }, now: env.now, staggerMs: 0 });
  env.at('2026-11-12T00:00:00Z');
  const orig = console.error; console.error = () => {};
  try { await failing.tick(); } finally { console.error = orig; }
  assert.equal((await contact()).checkin_last_sent_at, null);
});
