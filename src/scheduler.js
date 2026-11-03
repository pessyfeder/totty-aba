// Prompt scheduler (SPEC 5.4, 7). tick() is safe to run every minute and to run twice:
// prompts are unique per (goal, slot) and claimed with a conditional UPDATE before sending.
// Voice-call prompts (milestone 3) are not handled here yet; only channel = 'sms'.
import { Luxon } from 'kosher-zmanim';
import { locationFrom, windowAt } from './shabbos.js';
import { ShabbosRefusal } from './messaging.js';

const { DateTime } = Luxon;
const MAX_ATTEMPTS = 3;
const GENERATE_TOLERANCE_MS = 15 * 60e3;

export function buildBody(row, { reminder = false } = {}) {
  const code = row.n_goals > 1 && row.short_code ? `Goal ${row.short_code}: ` : '';
  const question = row.question_text ?? `${row.first_name}: ${row.title}. Did this happen today?`;
  const how =
    row.response_type === 'yes_no'
      ? 'Reply Y or N.'
      : 'Reply 0-5 (5 = best). You can add a comment after the number, e.g., `4 did great with reminders`.';
  return `${reminder ? 'Reminder: ' : ''}Hi, ${row.contact_name}. ${code}${question} ${how}`;
}

export function createScheduler({ db, messenger, now = () => new Date(), staggerMs = 1000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  /** Create today's and tomorrow's prompts for every active goal. Idempotent. */
  async function generatePrompts(at) {
    const { rows: goals } = await db.query(
      `SELECT g.id, g.contact_id, g.channel, g.schedule_json, g.created_at,
              to_char(g.start_date, 'YYYY-MM-DD') AS start_date,
              to_char(g.end_date, 'YYYY-MM-DD') AS end_date, cl.timezone
         FROM goal g
         JOIN client cl ON cl.id = g.client_id
         JOIN contact c ON c.id = g.contact_id
        WHERE g.status = 'active' AND cl.status = 'active' AND c.status = 'active' AND g.channel = 'sms'
        ORDER BY g.created_at, g.id`,
    );
    const seenPerContact = new Map();
    for (const g of goals) {
      const code = (seenPerContact.get(g.contact_id) ?? 0) + 1;
      seenPerContact.set(g.contact_id, code);
      const today = DateTime.fromJSDate(at, { zone: g.timezone }).startOf('day');
      for (const day of [today, today.plus({ days: 1 })]) {
        const date = day.toISODate();
        const dow = day.weekday % 7; // 0 = Sunday
        const { days, time } = g.schedule_json;
        if (!days.includes(dow) || date < g.start_date || (g.end_date && date > g.end_date)) continue;
        const when = DateTime.fromISO(`${date}T${time}`, { zone: g.timezone }).toJSDate();
        if (when.getTime() < at.getTime() - GENERATE_TOLERANCE_MS) continue;
        await db.query(
          `INSERT INTO prompt (goal_id, scheduled_for, prompt_date, short_code, channel)
           VALUES ($1, $2, $3, $4, 'sms') ON CONFLICT (goal_id, scheduled_for) DO NOTHING`,
          [g.id, when, date, code],
        );
      }
    }
  }

  const SEND_COLUMNS = `
    p.id, p.goal_id, p.scheduled_for, p.short_code, p.deferred_reason, p.attempts, p.sent_at,
    g.title, g.question_text, g.response_type,
    g.status AS goal_status, c.status AS contact_status, cl.status AS client_status,
    c.name AS contact_name, c.phone, cl.first_name,
    cl.latitude, cl.longitude, cl.timezone, cl.in_israel, cl.candle_lighting_minutes,
    cn.settings_json,
    (SELECT count(*)::int FROM goal g2 WHERE g2.contact_id = g.contact_id AND g2.status = 'active') AS n_goals`;
  const SEND_JOINS = `
    FROM prompt p
    JOIN goal g ON g.id = p.goal_id
    JOIN contact c ON c.id = g.contact_id
    JOIN client cl ON cl.id = g.client_id
    JOIN clinician cn ON cn.id = cl.clinician_id`;

  const setStatus = (id, status, extra = '', params = []) =>
    db.query(`UPDATE prompt SET status = $2 ${extra} WHERE id = $1`, [id, status, ...params]);

  async function sendDue(at) {
    const { rows } = await db.query(
      `SELECT ${SEND_COLUMNS} ${SEND_JOINS}
        WHERE p.status IN ('scheduled', 'deferred') AND p.scheduled_for <= $1 AND p.channel = 'sms'
        ORDER BY p.scheduled_for, p.short_code, p.id`,
      [at],
    );
    // Default policy: if a goal has several overdue prompts, only the latest is sent.
    const latest = new Map();
    for (const r of rows) latest.set(r.goal_id, r.id);

    for (const r of rows) {
      const settings = r.settings_json;
      if (r.goal_status !== 'active' || r.contact_status !== 'active' || r.client_status !== 'active') {
        await setStatus(r.id, 'skipped'); // paused/ended goal or contact stops all further prompts
        continue;
      }
      if (settings.deferred_prompt_policy !== 'send_all' && latest.get(r.goal_id) !== r.id) {
        await setStatus(r.id, 'skipped');
        continue;
      }
      const loc = locationFrom(r, settings);
      const window = windowAt(at, loc);
      if (window) {
        await setStatus(r.id, 'deferred', ', deferred_reason = $3', [window.kind]);
        continue;
      }
      // Prompts released from Shabbos go out at nightfall even if that is past quiet hours.
      const releasedFromShabbos = r.deferred_reason === 'shabbos' || r.deferred_reason === 'yom_tov';
      const q = settings.quiet_hours;
      const hhmm = DateTime.fromJSDate(at, { zone: r.timezone }).toFormat('HH:mm');
      if (!releasedFromShabbos && q && (hhmm < q.start || hhmm >= q.end)) {
        await setStatus(r.id, 'deferred', `, deferred_reason = 'quiet_hours'`);
        continue;
      }

      const { rows: claimed } = await db.query(
        `UPDATE prompt SET status = 'sending', attempts = attempts + 1
          WHERE id = $1 AND status IN ('scheduled', 'deferred') RETURNING id`,
        [r.id],
      );
      if (!claimed.length) continue; // another tick got it

      try {
        await messenger.send({ client: r, settings, to: r.phone, body: buildBody(r), promptId: r.id });
        await setStatus(r.id, 'sent', ', sent_at = $3', [at]);
        if (staggerMs) await sleep(staggerMs);
      } catch (err) {
        if (err instanceof ShabbosRefusal) {
          await setStatus(r.id, 'deferred', ', deferred_reason = $3', [err.window.kind]);
        } else {
          console.error(`prompt ${r.id} send failed:`, err.message);
          await setStatus(r.id, r.attempts + 1 >= MAX_ATTEMPTS ? 'failed' : 'scheduled');
        }
      }
    }
  }

  /** One reminder after N hours without a reply (default 3). Blocked windows just wait. */
  async function sendReminders(at) {
    const { rows } = await db.query(
      `SELECT ${SEND_COLUMNS} ${SEND_JOINS}
        WHERE p.status = 'sent' AND p.reminder_sent_at IS NULL AND p.channel = 'sms'
          AND p.sent_at <= $1::timestamptz - make_interval(hours => COALESCE((cn.settings_json->>'reminder_after_hours')::int, 3))
          AND g.status = 'active' AND c.status = 'active'`,
      [at],
    );
    for (const r of rows) {
      try {
        await messenger.send({ client: r, settings: r.settings_json, to: r.phone, body: buildBody(r, { reminder: true }), promptId: r.id });
        await db.query(`UPDATE prompt SET reminder_sent_at = $2 WHERE id = $1`, [r.id, at]);
      } catch (err) {
        if (!(err instanceof ShabbosRefusal)) console.error(`reminder ${r.id} failed:`, err.message);
      }
    }
  }

  /** At the end of the client's local day an unanswered prompt becomes no_response (never an N). */
  async function markNoResponse(at) {
    await db.query(
      `UPDATE prompt p SET status = 'no_response'
         FROM goal g JOIN client cl ON cl.id = g.client_id
        WHERE p.goal_id = g.id AND p.status = 'sent'
          AND ($1::timestamptz AT TIME ZONE cl.timezone)::date > p.prompt_date`,
      [at],
    );
  }

  async function tick() {
    const at = now();
    await generatePrompts(at);
    await sendDue(at);
    await sendReminders(at);
    await markNoResponse(at);
  }

  return { tick, generatePrompts, sendDue, sendReminders, markNoResponse };
}
