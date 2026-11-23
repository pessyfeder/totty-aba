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
      : 'Reply with the number of minutes, e.g. 15.';
  return `${reminder ? 'Reminder: ' : ''}Hi, ${row.contact_name}. ${code}${question} ${how}`;
}

export const CHECKIN_FIRST_AFTER_DAYS = 7;
// "Consistently responding": the first check-in text goes out only once the parent answered at least this share of the last 7 days' prompts.
export const CONSISTENT_SHARE = 0.7;
export const CHECKIN_EVERY_DAYS = 7;

export function buildCheckinBody(row, link) {
  return `Time to schedule a check-in for ${row.first_name} with Yisroel Feder, BCBA, LBA: ${link}. ` +
    'You can book and pay for your appointment there.';
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
        WHERE g.status = 'active' AND cl.status = 'active' AND cl.intake_status IN ('baseline', 'active')
          AND c.status = 'active' AND c.consent_given_at IS NOT NULL AND g.channel = 'sms'
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
    g.status AS goal_status, c.status AS contact_status, c.consent_given_at, cl.status AS client_status, cl.intake_status,
    c.id AS contact_id, c.name AS contact_name, c.phone, cl.first_name,
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
      if (r.goal_status !== 'active' || r.contact_status !== 'active' || !r.consent_given_at || r.client_status !== 'active' || !['baseline', 'active'].includes(r.intake_status)) {
        await setStatus(r.id, 'skipped'); // paused/ended goal or contact, or client not yet Go, stops all further prompts
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
        await db.query('UPDATE contact SET first_message_at = COALESCE(first_message_at, $2) WHERE id = $1', [r.contact_id, at]);
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

  /**
   * Follow-ups (SPEC 5.4): with no reply, one text after followup_after_minutes (default 120), then a catch-up
   * text the next morning (when quiet hours end), up to max_followups (default 2). With followup_catchup_morning
   * off, follow-ups instead repeat every followup_after_minutes. Never during quiet hours or a Shabbos window
   * (a follow-up that cannot go is simply dropped).
   */
  async function sendFollowUps(at) {
    const { rows } = await db.query(
      `SELECT ${SEND_COLUMNS}, p.followups_sent, p.last_followup_at, to_char(p.prompt_date, 'YYYY-MM-DD') AS prompt_day ${SEND_JOINS}
        WHERE p.status = 'sent' AND p.channel = 'sms'
          AND p.followups_sent < COALESCE((cn.settings_json->>'max_followups')::int, 2)
          AND p.sent_at > $1::timestamptz - interval '2 days'
          AND g.status = 'active' AND c.status = 'active' AND c.consent_given_at IS NOT NULL
          AND cl.status = 'active' AND cl.intake_status IN ('baseline', 'active')
        ORDER BY p.sent_at, p.id`,
      [at],
    );
    for (const r of rows) {
      const settings = r.settings_json;
      const local = DateTime.fromJSDate(at, { zone: r.timezone });
      const afterMs = (settings.followup_after_minutes ?? 120) * 60e3;
      const lastAt = new Date(r.last_followup_at ?? r.sent_at).getTime();
      let due;
      if (r.followups_sent === 0 || settings.followup_catchup_morning === false) {
        due = lastAt + afterMs <= at.getTime();
      } else {
        // Catch-up: the morning after the prompt, once, and not on the same day as the previous follow-up.
        const lastDay = DateTime.fromMillis(lastAt, { zone: r.timezone }).toISODate();
        due = local.toISODate() === DateTime.fromISO(r.prompt_day).plus({ days: 1 }).toISODate() && lastDay < local.toISODate();
      }
      if (!due) continue;
      const q = settings.quiet_hours;
      const hhmm = local.toFormat('HH:mm');
      if (q && (hhmm < q.start || hhmm >= q.end)) continue;
      try {
        await messenger.send({ client: r, settings, to: r.phone, body: buildBody(r, { reminder: true }), promptId: r.id });
        await db.query(
          `UPDATE prompt SET followups_sent = followups_sent + 1, last_followup_at = $2, reminder_sent_at = COALESCE(reminder_sent_at, $2)
            WHERE id = $1 AND status = 'sent' AND followups_sent = $3`,
          [r.id, at, r.followups_sent],
        );
        if (staggerMs) await sleep(staggerMs);
      } catch (err) {
        if (!(err instanceof ShabbosRefusal)) console.error(`follow-up ${r.id} failed:`, err.message);
      }
    }
  }

  /** Did this contact answer at least CONSISTENT_SHARE of the prompts that came due since they started (and at least one)? */
  async function respondsConsistently({ contact_id: contactId, first_message_at: since }, at) {
    const { rows: [r] } = await db.query(
      `SELECT count(*) FILTER (WHERE p.status = 'answered')::int AS answered, count(*)::int AS total
         FROM prompt p JOIN goal g ON g.id = p.goal_id
        WHERE g.contact_id = $1 AND p.status IN ('sent', 'answered', 'no_response', 'failed')
          AND p.scheduled_for >= $3::timestamptz - interval '1 day' AND p.scheduled_for <= $2`, [contactId, at, since]);
    return r.total > 0 && r.answered / r.total >= CONSISTENT_SHARE;
  }

  /**
   * After the first check-in appointment, a baseline client becomes active (SPEC 5.1a). The appointment must be a
   * check-in that has ended and that falls after baseline began.
   */
  async function activateAfterFirstCheckin(at) {
    await db.query(
      `UPDATE client SET intake_status = 'active', activated_at = COALESCE(activated_at, $1), updated_at = $1
        WHERE intake_status = 'baseline' AND status = 'active' AND EXISTS (
          SELECT 1 FROM appointment a WHERE a.client_id = client.id AND a.type = 'check-in' AND a.status = 'scheduled'
             AND COALESCE(a.ends_at, a.starts_at + interval '1 hour') <= $1
             AND (client.baseline_started_at IS NULL OR a.starts_at >= client.baseline_started_at))`, [at]);
  }

  /**
   * Check-in text (SPEC 5.7a): 7 days after a contact's first message (if they replied consistently), then every 7 days after the last one,
   * with the link to the website's scheduling portal. Same send rules as prompts: active client and contact, recorded
   * consent, never in a Shabbos/Yom Tov window or quiet hours. A blocked one is sent once the window ends.
   */
  async function sendCheckins(at) {
    const { rows } = await db.query(
      `SELECT c.id AS contact_id, c.name AS contact_name, c.phone, c.checkin_last_sent_at, c.first_message_at, cl.first_name, cl.intake_status,
              cl.latitude, cl.longitude, cl.timezone, cl.in_israel, cl.candle_lighting_minutes, cn.settings_json
         FROM contact c
         JOIN client cl ON cl.id = c.client_id
         JOIN clinician cn ON cn.id = cl.clinician_id
        WHERE c.status = 'active' AND c.phone IS NOT NULL AND c.consent_given_at IS NOT NULL
          AND cl.status = 'active' AND cl.intake_status IN ('baseline', 'active')
          AND c.first_message_at IS NOT NULL
          AND COALESCE(c.checkin_last_sent_at + make_interval(days => $2), c.first_message_at + make_interval(days => $3)) <= $1
        ORDER BY c.first_message_at, c.id`,
      [at, CHECKIN_EVERY_DAYS, CHECKIN_FIRST_AFTER_DAYS],
    );
    for (const r of rows) {
      const settings = r.settings_json;
      const link = settings.checkin_booking_url;
      if (!link) continue; // nothing to book with; sent once Totty sets the link
      if (!r.checkin_last_sent_at && !(await respondsConsistently(r, at))) continue; // first text waits for consistent replies
      if (windowAt(at, locationFrom(r, settings))) continue;
      const q = settings.quiet_hours;
      const hhmm = DateTime.fromJSDate(at, { zone: r.timezone }).toFormat('HH:mm');
      if (q && (hhmm < q.start || hhmm >= q.end)) continue;
      const { rows: claimed } = await db.query(
        `UPDATE contact SET checkin_last_sent_at = $2 WHERE id = $1 AND checkin_last_sent_at IS NOT DISTINCT FROM $3 RETURNING id`,
        [r.contact_id, at, r.checkin_last_sent_at],
      );
      if (!claimed.length) continue;
      try {
        await messenger.send({ client: r, settings, to: r.phone, body: buildCheckinBody(r, link) });
        if (staggerMs) await sleep(staggerMs);
      } catch (err) {
        await db.query('UPDATE contact SET checkin_last_sent_at = $2 WHERE id = $1', [r.contact_id, r.checkin_last_sent_at]);
        if (!(err instanceof ShabbosRefusal)) console.error(`check-in for contact ${r.contact_id} failed:`, err.message);
      }
    }
  }

  /**
   * At the end of the client's local day an unanswered prompt becomes no_response (never an N), except that
   * the next-morning catch-up still has a chance: it waits until the catch-up has gone out or the next day ends.
   */
  async function markNoResponse(at) {
    await db.query(
      `UPDATE prompt p SET status = 'no_response'
         FROM goal g
         JOIN client cl ON cl.id = g.client_id
         JOIN clinician cn ON cn.id = cl.clinician_id
        WHERE p.goal_id = g.id AND p.status = 'sent'
          AND ($1::timestamptz AT TIME ZONE cl.timezone)::date > p.prompt_date
          AND (COALESCE((cn.settings_json->>'followup_catchup_morning')::boolean, true) IS NOT TRUE
               OR p.followups_sent >= COALESCE((cn.settings_json->>'max_followups')::int, 2)
               OR ($1::timestamptz AT TIME ZONE cl.timezone)::date > p.prompt_date + 1)`,
      [at],
    );
  }

  async function tick() {
    const at = now();
    await generatePrompts(at);
    await sendDue(at);
    await sendFollowUps(at);
    await sendCheckins(at);
    await activateAfterFirstCheckin(at);
    await markNoResponse(at);
  }

  return { tick, activateAfterFirstCheckin, generatePrompts, sendDue, sendFollowUps, sendCheckins, markNoResponse };
}
