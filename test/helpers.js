import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { hashPassword } from '../src/auth.js';
import { createMessenger } from '../src/messaging.js';

const migrations = new URL('../db/migrations/', import.meta.url);

export async function makeDb() {
  const db = new PGlite();
  for (const f of (await readdir(migrations)).filter((n) => n.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(f, migrations), 'utf8'));
  }
  return db;
}

/** A controllable clock and a provider that records what would have been texted. */
export function makeEnv(db, start) {
  const clock = { t: new Date(start) };
  const now = () => clock.t;
  const sent = [];
  let n = 0;
  const provider = { async send(m) { sent.push(m); return { id: `SM${n++}` }; } };
  const messenger = createMessenger({ db, provider, now });
  return { clock, now, sent, messenger, at: (iso) => { clock.t = new Date(iso); } };
}

export const PASSWORD = 'correct horse battery';

/** One clinician in Brooklyn, one client in Lakewood, one contact, and no goals yet. */
export async function seedWorld(db, { email = 'totty@example.test' } = {}) {
  const one = async (sql, params) => (await db.query(sql, params)).rows[0];
  const clinician = await one(
    `INSERT INTO clinician (name, email, password_hash, timezone, latitude, longitude)
     VALUES ('Totty', $1, $2, 'America/New_York', 40.6782, -73.9442) RETURNING *`,
    [email, await hashPassword(PASSWORD)],
  );
  const client = await one(
    `INSERT INTO client (clinician_id, first_name, last_name, admission_date, latitude, longitude, timezone, intake_status, activated_at)
     VALUES ($1, 'Dovid', 'Cohen', '2026-09-01', 40.0979, -74.2176, 'America/New_York', 'active', now()) RETURNING *`,
    [clinician.id],
  );
  const contact = await one(
    `INSERT INTO contact (client_id, name, phone) VALUES ($1, 'Mrs. Cohen', '+15555550100') RETURNING *`,
    [client.id],
  );
  const addGoal = (title, { type = 'yes_no', days = [0, 1, 2, 3, 4, 5, 6], time = '18:30', status = 'active', question = null } = {}) =>
    one(
      `INSERT INTO goal (client_id, contact_id, title, question_text, response_type, channel, schedule_json, start_date, status)
       VALUES ($1, $2, $3, $4, $5, 'sms', $6, '2026-09-08', $7) RETURNING *`,
      [client.id, contact.id, title, question, type, JSON.stringify({ days, time }), status],
    );
  return { clinician, client, contact, addGoal, one };
}
