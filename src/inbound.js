// Inbound SMS handling (SPEC 5.4). Replies are recorded at any time, including Shabbos.
import { extractCode, parseReply } from './parse.js';
import { ShabbosRefusal } from './messaging.js';

const LATE_REPLY_HOURS = 24;

/** Prompts a parent can still answer: sent and unanswered, or marked no_response within the late window. */
async function openPrompts(db, contactId, now, lateHours) {
  const { rows } = await db.query(
    `SELECT p.id, p.short_code, p.sent_at, g.response_type, g.title, cl.first_name
       FROM prompt p
       JOIN goal g ON g.id = p.goal_id
       JOIN client cl ON cl.id = g.client_id
      WHERE g.contact_id = $1
        AND p.status IN ('sent', 'no_response')
        AND p.sent_at > $2::timestamptz - make_interval(hours => $3)
      ORDER BY p.sent_at DESC`,
    [contactId, now, lateHours],
  );
  return rows;
}

/**
 * @returns {Promise<{outcome: 'recorded'|'reprompted'|'no_open_prompt'|'unknown_sender', promptId?: string}>}
 */
export async function handleInbound({ db, messenger, from, body, providerId = null, now = new Date(), lateHours = LATE_REPLY_HOURS }) {
  const log = (status, promptId = null) =>
    db.query(
      `INSERT INTO message_log (direction, to_from, body, provider_id, status, prompt_id)
       VALUES ('inbound', $1, $2, $3, $4, $5)`,
      [from, body, providerId, status, promptId],
    );

  const { rows: contacts } = await db.query(
    `SELECT c.id, c.client_id, cl.clinician_id FROM contact c JOIN client cl ON cl.id = c.client_id
      WHERE c.phone = $1 ORDER BY (c.status = 'active') DESC LIMIT 1`,
    [from],
  );
  if (!contacts.length) {
    await log('received');
    return { outcome: 'unknown_sender' };
  }
  const contact = contacts[0];

  const open = await openPrompts(db, contact.id, now, lateHours);
  if (!open.length) {
    await log('received');
    return { outcome: 'no_open_prompt' };
  }

  const { code, rest } = extractCode(body);
  // Matched to the most recent open prompt unless a code is given.
  const target = (code != null && open.find((p) => p.short_code === code)) || open[0];

  const parsed = parseReply(rest, target.response_type);
  if (parsed.ok) {
    await db.query(
      `INSERT INTO response (prompt_id, received_at, value_bool, value_minutes, raw_text, source)
       VALUES ($1, $2, $3, $4, $5, 'sms')`,
      [target.id, now, parsed.valueBool ?? null, parsed.valueMinutes ?? null, body],
    );
    await db.query(`UPDATE prompt SET status = 'answered' WHERE id = $1`, [target.id]);
    await log('received', target.id);
    return { outcome: 'recorded', promptId: target.id };
  }

  // Unusable: tell the parent so and ask them to try again, every time. Nothing is queued for Totty.
  await log('unparsed', target.id);
  await sendReprompt({ db, messenger, contact, target, from });
  return { outcome: 'reprompted', promptId: target.id };
}

async function sendReprompt({ db, messenger, contact, target, from }) {
  const { rows } = await db.query(
    `SELECT cl.*, cn.settings_json FROM client cl JOIN clinician cn ON cn.id = cl.clinician_id WHERE cl.id = $1`,
    [contact.client_id],
  );
  const hint = target.response_type === 'yes_no' ? 'Please reply Y or N.' : 'Please reply with a number of minutes, e.g. 15.';
  try {
    await messenger.send({ client: rows[0], settings: rows[0].settings_json, to: from, body: `Sorry, I couldn't read that reply. ${hint}`, promptId: target.id });
  } catch (err) {
    if (!(err instanceof ShabbosRefusal)) throw err; // the reply itself is already recorded
  }
}
