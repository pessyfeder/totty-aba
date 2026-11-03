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
await prompt(spoon, 5, 'answered');
const p2 = await prompt(bedtime, 2, 'sent');
await db.query(`INSERT INTO response (prompt_id, raw_text, source, parse_status) VALUES ($1, 'he was kind of ok?', 'sms', 'unparsed')`, [p2.id]);
await prompt(spoon, 0, 'scheduled');

const messenger = createMessenger({ db, provider: consoleProvider() });
const app = createApp({ db, messenger, config: { sessionSecret: 'demo-secret-demo-secret-demo-secret-1234', production: false } });
const port = Number(process.argv[2] ?? 3000);
app.listen(port, () => console.log(`demo on http://localhost:${port}  login: totty@example.test / ${PASSWORD}`));
