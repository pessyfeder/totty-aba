// Scheduler + Shabbos guard + inbound replies, end to end against Postgres (PGlite) with a fake clock.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb, makeEnv, seedWorld } from './helpers.js';
import { createScheduler } from '../src/scheduler.js';
import { handleInbound } from '../src/inbound.js';
import { ShabbosRefusal } from '../src/messaging.js';

let db, env, world, scheduler;
const WED = '2026-11-04T23:31:00Z'; // 6:31pm EST, one minute after an 18:30 prompt

beforeEach(async () => {
  db = await makeDb();
  env = makeEnv(db, WED);
  world = await seedWorld(db);
  scheduler = createScheduler({ db, messenger: env.messenger, now: env.now, staggerMs: 0 });
});

const inbound = (body, from = '+15555550100') => handleInbound({ db, messenger: env.messenger, from, body, now: env.now() });
const prompts = async () => (await db.query('SELECT * FROM prompt ORDER BY scheduled_for')).rows;
const outbound = async () => (await db.query(`SELECT * FROM message_log WHERE direction = 'outbound' AND status = 'sent'`)).rows;

test('a due prompt is texted once, even if the tick runs twice', async () => {
  await world.addGoal('Uses a spoon', { question: 'Did Dovid use a spoon at dinner today?' });
  await scheduler.tick();
  await scheduler.tick();
  assert.equal(env.sent.length, 1);
  assert.match(env.sent[0].body, /^Hi, Mrs\. Cohen\. Did Dovid use a spoon at dinner today\? Reply Y or N\.$/);
  assert.equal((await prompts()).filter((p) => p.status === 'sent').length, 1);
});

test('AC1: Saturday 10:00 prompt is deferred, then sent right after nightfall', async () => {
  await world.addGoal('Uses a spoon', { days: [6], time: '10:00' });
  env.at('2026-11-07T15:05:00Z'); // Sat 10:05 EST
  await scheduler.tick();
  assert.equal(env.sent.length, 0);
  const [p] = await prompts();
  assert.equal(p.status, 'deferred');
  assert.equal(p.deferred_reason, 'shabbos');

  env.at('2026-11-07T22:58:00Z'); // still before nightfall (22:59:30Z)
  await scheduler.tick();
  assert.equal(env.sent.length, 0);

  env.at('2026-11-07T23:01:00Z'); // 90 seconds after nightfall, within the 5 minute requirement
  await scheduler.tick();
  assert.equal(env.sent.length, 1);
});

test('AC2: Friday 5:00pm with 4:30pm candle lighting is deferred to Saturday nightfall', async () => {
  await world.addGoal('Uses a spoon', { days: [5], time: '17:00' });
  env.at('2026-11-06T22:02:00Z'); // Fri 5:02pm EST
  await scheduler.tick();
  assert.equal(env.sent.length, 0);
  assert.equal((await prompts())[0].deferred_reason, 'shabbos');
  env.at('2026-11-07T23:01:00Z');
  await scheduler.tick();
  assert.equal(env.sent.length, 1);
});

test('AC8: calling send directly during Shabbos is refused and logged', async () => {
  env.at('2026-11-07T15:00:00Z');
  await assert.rejects(
    env.messenger.send({ client: world.client, settings: world.clinician.settings_json, to: '+15555550100', body: 'x' }),
    ShabbosRefusal,
  );
  assert.equal(env.sent.length, 0);
  const { rows } = await db.query(`SELECT status, refusal_reason FROM message_log`);
  assert.equal(rows[0].status, 'refused');
  assert.match(rows[0].refusal_reason, /^shabbos until /);
});

test('AC7: a paused goal or contact gets no prompts', async () => {
  const g = await world.addGoal('Uses a spoon');
  await db.query(`UPDATE goal SET status = 'paused' WHERE id = $1`, [g.id]);
  await scheduler.tick();
  assert.equal(env.sent.length, 0);

  await db.query(`UPDATE goal SET status = 'active' WHERE id = $1`, [g.id]);
  await db.query(`UPDATE contact SET status = 'paused'`);
  await scheduler.tick();
  assert.equal(env.sent.length, 0);
});

test('overdue prompts for one goal collapse to the latest (send_latest_only)', async () => {
  const g = await world.addGoal('Uses a spoon');
  for (const [when, date] of [['2026-11-02T23:30:00Z', '2026-11-02'], ['2026-11-03T23:30:00Z', '2026-11-03']]) {
    await db.query(`INSERT INTO prompt (goal_id, scheduled_for, prompt_date, short_code, channel) VALUES ($1, $2, $3, 1, 'sms')`, [g.id, when, date]);
  }
  env.at('2026-11-04T15:00:00Z'); // 10am EST, outside quiet hours
  await scheduler.sendDue(env.now());
  const rows = await prompts();
  assert.deepEqual(rows.map((p) => p.status), ['skipped', 'sent']);
});

test('quiet hours defer a prompt until morning', async () => {
  await world.addGoal('Uses a spoon', { time: '22:00' });
  env.at('2026-11-05T03:05:00Z'); // 10:05pm EST
  await scheduler.tick();
  assert.equal(env.sent.length, 0);
  assert.equal((await prompts())[0].deferred_reason, 'quiet_hours');
  env.at('2026-11-05T13:05:00Z'); // 8:05am EST
  await scheduler.sendDue(env.now());
  assert.equal(env.sent.length, 1);
});

test('AC3: replying "y" records true and answers the prompt', async () => {
  await world.addGoal('Uses a spoon');
  await scheduler.tick();
  assert.equal((await inbound('y')).outcome, 'recorded');
  const { rows } = await db.query('SELECT * FROM response');
  assert.equal(rows[0].value_bool, true);
  assert.equal((await prompts())[0].status, 'answered');
});

test('AC4: "3 tough day, needed help" stores value 3 and the comment', async () => {
  await world.addGoal('Bedtime routine', { type: 'rating' });
  await scheduler.tick();
  await inbound('3 tough day, needed help');
  const { rows } = await db.query('SELECT * FROM response');
  assert.equal(rows[0].value_int, 3);
  assert.equal(rows[0].comment, 'tough day, needed help');
});

test('with several open prompts a "Goal N" code picks the prompt, otherwise the most recent', async () => {
  await world.addGoal('Uses a spoon');
  await world.addGoal('Bedtime routine', { type: 'rating' });
  await scheduler.tick();
  assert.match(env.sent[0].body, /Goal 1:/);
  assert.match(env.sent[1].body, /Goal 2:/);
  await inbound('Goal 1: n');
  const { rows } = await db.query(`SELECT r.value_bool, g.title FROM response r JOIN prompt p ON p.id = r.prompt_id JOIN goal g ON g.id = p.goal_id`);
  assert.deepEqual(rows.map((r) => [r.title, r.value_bool]), [['Uses a spoon', false]]);
});

test('unparseable reply: one re-prompt, then stored as unparsed for review', async () => {
  await world.addGoal('Uses a spoon');
  await scheduler.tick();
  assert.equal((await inbound('he was great!')).outcome, 'reprompted');
  assert.equal(env.sent.length, 2);
  assert.match(env.sent[1].body, /Please reply Y or N/);
  assert.equal((await inbound('he was great!!')).outcome, 'unparsed');
  const { rows } = await db.query(`SELECT raw_text, parse_status FROM response`);
  assert.deepEqual(rows, [{ raw_text: 'he was great!!', parse_status: 'unparsed' }]);
});

test('AC9: replies during Shabbos are still recorded, and nothing is sent back', async () => {
  await world.addGoal('Uses a spoon', { days: [5], time: '15:00' }); // Friday 3pm, before candle lighting
  env.at('2026-11-06T20:05:00Z'); // 3:05pm EST
  await scheduler.tick();
  assert.equal(env.sent.length, 1);
  env.at('2026-11-07T15:00:00Z'); // Saturday
  assert.equal((await inbound('maybe')).outcome, 'reprompted'); // re-prompt itself is refused, not thrown
  assert.equal(env.sent.length, 1);
  assert.equal((await inbound('y')).outcome, 'recorded');
  assert.equal((await db.query('SELECT 1 FROM response')).rows.length, 1);
});

test('AC5: unanswered becomes no_response at day end; a late reply still attaches to that prompt', async () => {
  await world.addGoal('Uses a spoon');
  await scheduler.tick();
  env.at('2026-11-05T06:00:00Z'); // 1am next day, local
  await scheduler.markNoResponse(env.now());
  assert.equal((await prompts())[0].status, 'no_response');
  assert.equal((await db.query('SELECT 1 FROM response')).rows.length, 0); // never counted as N
  assert.equal((await inbound('y')).outcome, 'recorded');
  assert.equal((await prompts())[0].status, 'answered');
  assert.equal((await prompts())[0].prompt_date.toISOString().slice(0, 10), '2026-11-04');
});

test('follow-ups: one every 30 minutes without a reply, at most 3, never a fourth', async () => {
  await world.addGoal('Uses a spoon');
  await scheduler.tick();
  assert.equal(env.sent.length, 1);
  env.at('2026-11-04T23:55:00Z'); // 24 min after the prompt: too early
  await scheduler.sendFollowUps(env.now());
  assert.equal(env.sent.length, 1);
  for (const [i, t] of ['2026-11-05T00:02:00Z', '2026-11-05T00:33:00Z', '2026-11-05T01:04:00Z'].entries()) {
    env.at(t);
    await scheduler.sendFollowUps(env.now());
    await scheduler.sendFollowUps(env.now()); // a second pass in the same minute sends nothing
    assert.equal(env.sent.length, 2 + i);
    assert.match(env.sent.at(-1).body, /^Reminder: /);
  }
  env.at('2026-11-05T03:00:00Z');
  await scheduler.sendFollowUps(env.now());
  assert.equal(env.sent.length, 4); // the prompt plus 3 follow-ups
  assert.equal((await prompts())[0].followups_sent, 3);
});

test('a reply stops further follow-ups', async () => {
  await world.addGoal('Uses a spoon');
  await scheduler.tick();
  env.at('2026-11-05T00:02:00Z');
  await scheduler.sendFollowUps(env.now());
  assert.equal(env.sent.length, 2);
  await inbound('y');
  env.at('2026-11-05T00:40:00Z');
  await scheduler.sendFollowUps(env.now());
  assert.equal(env.sent.length, 2);
});

test('follow-ups are not sent in quiet hours or during Shabbos', async () => {
  await world.addGoal('Uses a spoon', { time: '20:45' });
  env.at('2026-11-05T01:50:00Z'); // 8:50pm EST Wednesday
  await scheduler.tick();
  assert.equal(env.sent.length, 1);
  env.at('2026-11-05T02:20:00Z'); // 9:20pm: quiet hours (default 21:00 end)
  await scheduler.sendFollowUps(env.now());
  assert.equal(env.sent.length, 1);

  await db.query(`UPDATE prompt SET sent_at = '2026-11-07T15:00:00Z', followups_sent = 0, last_followup_at = NULL`);
  env.at('2026-11-07T16:00:00Z'); // Saturday noon
  await scheduler.sendFollowUps(env.now());
  assert.equal(env.sent.length, 1);
  assert.equal((await outbound()).length, 1);
  assert.equal((await prompts())[0].followups_sent, 0);
});

test('follow-up timing and count come from settings', async () => {
  await db.query(`UPDATE clinician SET settings_json = settings_json || '{"followup_after_minutes": 10, "max_followups": 1}'`);
  await world.addGoal('Uses a spoon');
  await scheduler.tick();
  env.at('2026-11-04T23:45:00Z');
  await scheduler.sendFollowUps(env.now());
  env.at('2026-11-04T23:58:00Z');
  await scheduler.sendFollowUps(env.now());
  assert.equal(env.sent.length, 2);
});

test('replies from unknown numbers are logged and ignored', async () => {
  assert.equal((await inbound('y', '+15555559999')).outcome, 'unknown_sender');
  assert.equal((await db.query('SELECT 1 FROM message_log WHERE direction = $1', ['inbound'])).rows.length, 1);
});
