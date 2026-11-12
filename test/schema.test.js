import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8');
let db;

before(async () => {
  db = new PGlite();
  for (const f of ['001_init', '002_goal_question_text', '003_rename_incentive_to_reinforcement', '004_goal_archived_status', '005_followups', '006_duration_replaces_rating']) await db.exec(await read(`db/migrations/${f}.sql`));
  await db.exec(await read('db/seed.sql'));
});

const rejects = (sql, params) => assert.rejects(db.query(sql, params));

test('seed loads with expected shape', async () => {
  const { rows } = await db.query('SELECT count(*)::int AS n FROM goal');
  assert.equal(rows[0].n, 2);
});

test('clinician default settings carry 72 minute nightfall', async () => {
  const { rows } = await db.query('SELECT settings_json FROM clinician');
  assert.equal(rows[0].settings_json.nightfall_minutes_after_sunset, 72);
});

test('client requires admission_date', async () => {
  await rejects(
    `INSERT INTO client (clinician_id, first_name, last_name, timezone)
     VALUES ('00000000-0000-0000-0000-000000000001', 'A', 'B', 'UTC')`,
  );
});

test('goal date_added defaults to today and response_type is constrained', async () => {
  const { rows } = await db.query(`SELECT date_added = current_date AS ok FROM goal LIMIT 1`);
  assert.equal(rows[0].ok, true);
  await rejects(
    `INSERT INTO goal (client_id, contact_id, title, response_type, channel, schedule_json, start_date)
     SELECT client_id, id, 'x', 'both', 'sms', '{}', current_date FROM contact`,
  );
});

test('no prompt is sent twice: unique per goal and scheduled instant', async () => {
  const { rows } = await db.query('SELECT id FROM goal LIMIT 1');
  const ins = `INSERT INTO prompt (goal_id, scheduled_for, prompt_date, channel)
               VALUES ($1, '2026-11-06 23:30+00', '2026-11-06', 'sms')`;
  await db.query(ins, [rows[0].id]);
  await rejects(ins, [rows[0].id]);
});

test('minutes are limited to 0-1440 and responses have no comment column', async () => {
  const { rows } = await db.query('SELECT id FROM prompt LIMIT 1');
  const id = rows[0].id;
  await rejects(`INSERT INTO response (prompt_id, value_minutes, source) VALUES ($1, 1441, 'sms')`, [id]);
  await rejects(`INSERT INTO response (prompt_id, value_minutes, comment, source) VALUES ($1, 3, 'x', 'sms')`, [id]);
  await db.query(
    `INSERT INTO response (prompt_id, value_minutes, source) VALUES ($1, 30, 'sms')`,
    [id],
  );
});

test('unparsed responses may have no value; parsed ones may not', async () => {
  const { rows } = await db.query('SELECT id FROM prompt LIMIT 1');
  const id = rows[0].id;
  await db.query(
    `INSERT INTO response (prompt_id, raw_text, source, parse_status) VALUES ($1, 'huh?', 'sms', 'unparsed')`,
    [id],
  );
  await rejects(`INSERT INTO response (prompt_id, raw_text, source) VALUES ($1, 'huh?', 'sms')`, [id]);
});

test('contact phone must be E.164', async () => {
  await rejects(`UPDATE contact SET phone = '555-0100'`);
});
