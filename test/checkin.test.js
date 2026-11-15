// Bi-weekly check-in text (SPEC 5.7a, AC 11).
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
  await db.query(`UPDATE contact SET consent_given_at = now() WHERE id = $1`, [world.contact.id]);
  await db.query(`UPDATE clinician SET settings_json = jsonb_set(settings_json, '{checkin_booking_url}', to_jsonb($1::text))`, [LINK]);
  await world.addGoal('Uses a spoon', { time: '18:30' });
  scheduler = createScheduler({ db, messenger: env.messenger, now: env.now, staggerMs: 0 });
  await scheduler.tick(); // first prompt goes out: starts the 7-day clock
  env.sent.length = 0;
});

const contact = async () => (await db.query('SELECT * FROM contact WHERE id = $1', [world.contact.id])).rows[0];
const checkins = () => env.sent.filter((m) => /schedule a check-in/.test(m.body));

test('the first prompt sets first_message_at; nothing is sent before 14 days', async () => {
  assert.ok((await contact()).first_message_at);
  env.at('2026-11-18T18:00:00Z'); // 13 days 18.5 hours later
  await scheduler.sendCheckins(env.now());
  assert.equal(checkins().length, 0);
});

test('14 days after the first message the check-in goes out once, then every 14 days', async () => {
  env.at('2026-11-18T23:32:00Z');
  await scheduler.sendCheckins(env.now());
  await scheduler.sendCheckins(env.now()); // a second pass sends nothing
  assert.equal(checkins().length, 1);
  assert.equal(checkins()[0].to, '+15555550100');
  assert.equal(checkins()[0].body,
    `Time to schedule a check-in for Dovid with Yisroel Feder, BCBA, LBA: ${LINK}. Please remember payment is due 48 hours before your appointment.`);

  env.at('2026-12-02T22:00:00Z'); // 13 days later: not yet
  await scheduler.sendCheckins(env.now());
  assert.equal(checkins().length, 1);
  env.at('2026-12-02T23:33:00Z'); // 14 days later
  await scheduler.sendCheckins(env.now());
  assert.equal(checkins().length, 2);
});

test('nothing is sent without a link, consent, an active contact, or an active client', async () => {
  env.at('2026-11-18T23:32:00Z');
  await db.query(`UPDATE clinician SET settings_json = settings_json - 'checkin_booking_url'`);
  await scheduler.sendCheckins(env.now());
  await db.query(`UPDATE clinician SET settings_json = jsonb_set(settings_json, '{checkin_booking_url}', to_jsonb($1::text))`, [LINK]);
  await db.query(`UPDATE contact SET consent_given_at = NULL`);
  await scheduler.sendCheckins(env.now());
  await db.query(`UPDATE contact SET consent_given_at = now(), status = 'paused'`);
  await scheduler.sendCheckins(env.now());
  await db.query(`UPDATE contact SET status = 'active'`);
  await db.query(`UPDATE client SET intake_status = 'ready'`);
  await scheduler.sendCheckins(env.now());
  assert.equal(checkins().length, 0);
});

test('a paused contact gets one check-in on resume, not a backlog', async () => {
  await db.query(`UPDATE contact SET status = 'paused'`);
  env.at('2026-12-20T23:32:00Z'); // weeks overdue
  await scheduler.sendCheckins(env.now());
  assert.equal(checkins().length, 0);
  await db.query(`UPDATE contact SET status = 'active'`);
  await scheduler.sendCheckins(env.now());
  await scheduler.sendCheckins(env.now());
  assert.equal(checkins().length, 1);
});

test('a check-in due during Shabbos is sent after it ends, never dropped or logged as refused', async () => {
  env.at('2026-11-21T15:00:00Z'); // Saturday 10am EST, overdue since Wed
  await scheduler.sendCheckins(env.now());
  assert.equal(checkins().length, 0);
  assert.equal((await db.query(`SELECT 1 FROM message_log WHERE status = 'refused'`)).rows.length, 0);
  env.at('2026-11-21T23:00:00Z'); // Saturday 6pm, after nightfall
  await scheduler.sendCheckins(env.now());
  assert.equal(checkins().length, 1);
});

test('a check-in is not sent in quiet hours', async () => {
  await db.query(`UPDATE clinician SET settings_json = jsonb_set(settings_json, '{quiet_hours}', '{"start":"08:00","end":"21:00"}')`);
  env.at('2026-11-19T05:00:00Z'); // Thu midnight EST
  await scheduler.sendCheckins(env.now());
  assert.equal(checkins().length, 0);
  env.at('2026-11-19T15:00:00Z');
  await scheduler.sendCheckins(env.now());
  assert.equal(checkins().length, 1);
});
