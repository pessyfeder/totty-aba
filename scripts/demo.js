// Runs the real app on an in-memory Postgres (PGlite) with sample data, so the dashboard can be
// tried without installing PostgreSQL. Data is lost on exit. Log in as totty@example.test.
// Usage: node scripts/demo.js [port]
import { makeDb, makeEnv, seedWorld, PASSWORD } from '../test/helpers.js';
import { createApp } from '../src/app.js';
import { createMessenger, consoleProvider } from '../src/messaging.js';

const db = await makeDb();
const w = await seedWorld(db);
const spoon = await w.addGoal('Uses a spoon', { question: 'Did Dovid use a spoon at dinner today?' });
const bedtime = await w.addGoal('Bedtime routine', { type: 'rating', time: '20:00' });
await db.query(`INSERT INTO incentive (client_id, name, note) VALUES ($1, 'bubbles', NULL), ($1, 'iPad time', '5 minute max')`, [w.client.id]);

const prompt = (goal, hoursAgo, status) =>
  w.one(
    `INSERT INTO prompt (goal_id, scheduled_for, prompt_date, short_code, sent_at, channel, status)
     VALUES ($1, now() - make_interval(hours => $2), (now() AT TIME ZONE 'America/New_York')::date, 1, now() - make_interval(hours => $2), 'sms', $3) RETURNING id`,
    [goal.id, hoursAgo, status],
  );
// Six weeks of history so the charts have something to show (a few days left unanswered on purpose).
await db.query(`UPDATE goal SET target_json = '{"type":"percent_yes","threshold":80}' WHERE id = $1`, [spoon.id]);
await db.query(`UPDATE goal SET target_json = '{"type":"avg_rating","threshold":4}' WHERE id = $1`, [bedtime.id]);
for (let i = 42; i >= 1; i--) {
  for (const [goal, rate] of [[spoon, i / 42], [bedtime, i / 42]]) {
    const p = await w.one(
      `INSERT INTO prompt (goal_id, scheduled_for, prompt_date, short_code, sent_at, channel, status)
       VALUES ($1, now() - make_interval(days => $2), (now() - make_interval(days => $2)) AT TIME ZONE 'America/New_York', 1, now() - make_interval(days => $2), 'sms', $3) RETURNING id`,
      [goal.id, i, i % 9 === 0 ? 'no_response' : 'answered'],
    );
    if (i % 9 === 0) continue;
    const better = Math.random() > rate * 0.7; // improves over time
    await db.query(
      `INSERT INTO response (prompt_id, value_bool, value_int, source, raw_text, comment) VALUES ($1, $2, $3, 'sms', 'demo', $4)`,
      [p.id, goal === spoon ? better : null, goal === bedtime ? Math.min(5, Math.round(1 + (1 - rate) * 3 + Math.random() * 1.5)) : null, i % 11 === 0 ? 'tough day, needed help' : null],
    );
  }
}
await db.query(`INSERT INTO annotation (goal_id, date, text) VALUES ($1, current_date - 21, 'New visual schedule started')`, [spoon.id]);
await prompt(spoon, 5, 'answered');
const p2 = await prompt(bedtime, 2, 'sent');
await db.query(`INSERT INTO response (prompt_id, raw_text, source, parse_status) VALUES ($1, 'he was kind of ok?', 'sms', 'unparsed')`, [p2.id]);
await prompt(spoon, 0, 'scheduled');

const messenger = createMessenger({ db, provider: consoleProvider() });
const app = createApp({ db, messenger, config: { sessionSecret: 'demo-secret-demo-secret-demo-secret-1234', production: false } });
const port = Number(process.argv[2] ?? 3000);
app.listen(port, () => console.log(`demo on http://localhost:${port}  login: totty@example.test / ${PASSWORD}`));
