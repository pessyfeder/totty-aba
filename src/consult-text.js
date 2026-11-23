// Initial consultation text, sent alongside the consultation email (SPEC 5.7b). When the client reaches "information
// submitted" the app drafts a text carrying CONSULT_BOOKING_URL. Totty reviews and approves it; only then is it sent.
// The text holds only the child's first name and the link (no PHI).
// It needs a contact that is active, has a mobile number and recorded text consent. Without one it is not sent and
// the client page says why.
// Shabbos / Yom Tov: an approved text waits while the window is open and goes out after it (the scheduler tick retries).
import { locationFrom, windowAt } from './shabbos.js';
import { ShabbosRefusal } from './messaging.js';

const MAX_ATTEMPTS = 3;
const RETRY_AFTER_MS = 30 * 60e3; // a failed send is retried no sooner than this

/** The text. Pure. */
export function buildConsultText({ client, link }) {
  return `Thank you, the information for ${client.first_name} has been successfully submitted. Book the consultation with Yisroel Feder, BCBA, LBA: ${link}`;
}

/** First contact that can be texted: active, has a number and recorded consent. */
export const recipientOf = (contacts) => contacts.find((c) => c.status === 'active' && c.phone && String(c.phone).trim() && c.consent_given_at);

/** Why nobody can be texted, in plain words. Null when somebody can. */
export function noRecipientReason(contacts) {
  if (!contacts.length) return 'Add a parent or caregiver contact with a mobile number first.';
  const live = contacts.filter((c) => c.status === 'active');
  if (!live.length) return 'Every contact is paused or ended, so no text can go out.';
  const withPhone = live.filter((c) => c.phone && String(c.phone).trim());
  if (!withPhone.length) return 'Add a mobile number for a parent or caregiver first.';
  if (!withPhone.some((c) => c.consent_given_at)) return 'No text consent is recorded for a contact with a mobile number. Record it on the contact first.';
  return null;
}

/** Creates the draft when the client is at "information submitted". Idempotent; never makes a second one. */
export async function ensureDraft(db, clientId) {
  const { rows } = await db.query(
    `INSERT INTO consult_text (client_id) SELECT id FROM client WHERE id = $1 AND intake_status = 'information_submitted'
     ON CONFLICT (client_id) DO NOTHING RETURNING client_id`, [clientId]);
  return rows.length > 0;
}

async function load(db, clientId) {
  const { rows: [client] } = await db.query(
    `SELECT c.*, cn.settings_json FROM client c JOIN clinician cn ON cn.id = c.clinician_id WHERE c.id = $1`, [clientId]);
  if (!client) return null;
  const { rows: contacts } = await db.query('SELECT * FROM contact WHERE client_id = $1 ORDER BY id', [clientId]);
  return { client, contacts, settings: client.settings_json, link: client.settings_json?.consult_booking_url ?? '' };
}

/** What Totty reviews: status, recipient, the exact text, and anything that blocks sending. Null when no draft exists. */
export async function preview(db, clientId, now = () => new Date()) {
  const { rows: [row] } = await db.query('SELECT * FROM consult_text WHERE client_id = $1', [clientId]);
  if (!row) return null;
  const w = await load(db, clientId);
  const to = recipientOf(w.contacts);
  const problems = [];
  if (!w.link) problems.push('Set the consultation booking link in Settings first.');
  const why = noRecipientReason(w.contacts);
  if (why) problems.push(why);
  const out = { status: row.status, sent_at: row.sent_at, approved_at: row.approved_at, last_error: row.last_error, problems };
  if (row.status === 'sent') return { ...out, to: row.to_phone };
  if (to) out.to = to.phone.trim();
  if (w.link) out.text = buildConsultText({ client: w.client, link: w.link });
  if (row.status === 'approved') { // queued: say whether it is the Shabbos window holding it
    const win = windowAt(now(), locationFrom(w.client, w.settings));
    if (win) out.queued_until = win.end;
  }
  return out;
}

/** Totty's approval. Throws a user-facing Error when the text cannot go out yet. */
export async function approve(db, clientId) {
  const p = await preview(db, clientId);
  if (!p) throw new Error('There is no consultation text for this client');
  if (p.status !== 'pending_approval') throw new Error(`This text is already ${p.status === 'cancelled' ? 'declined' : p.status.replace('_', ' ')}`);
  if (p.problems.length) throw new Error(p.problems[0]);
  const { rows } = await db.query(
    `UPDATE consult_text SET status = 'approved', approved_at = now()
      WHERE client_id = $1 AND status = 'pending_approval'
        AND EXISTS (SELECT 1 FROM client WHERE id = $1 AND intake_status = 'information_submitted') RETURNING client_id`, [clientId]);
  if (!rows.length) throw new Error('The client is no longer at "Information submitted", so the text was not approved');
}

/** Totty declines to send it. */
export async function cancel(db, clientId) {
  const { rows } = await db.query(
    `UPDATE consult_text SET status = 'cancelled' WHERE client_id = $1 AND status IN ('pending_approval', 'approved') RETURNING client_id`, [clientId]);
  return rows.length > 0;
}

/**
 * Sends every approved text that can go out now (all of them, or one client's). Safe to run on every tick and twice:
 * each row is claimed with a conditional UPDATE first. Returns the client ids that were texted.
 */
export async function sendApproved({ db, messenger, now = () => new Date(), clientId = null }) {
  const { rows } = await db.query(
    `SELECT t.client_id FROM consult_text t WHERE t.status = 'approved' AND ($1::uuid IS NULL OR t.client_id = $1)
        AND (t.next_attempt_at IS NULL OR t.next_attempt_at <= $2) ORDER BY t.approved_at`, [clientId, now()]);
  const sent = [];
  for (const { client_id } of rows) {
    const w = await load(db, client_id);
    if (w.client.intake_status !== 'information_submitted' || w.client.status !== 'active') { // moved on or archived: no longer needed
      await db.query(`UPDATE consult_text SET status = 'cancelled' WHERE client_id = $1 AND status = 'approved'`, [client_id]);
      continue;
    }
    if (windowAt(now(), locationFrom(w.client, w.settings))) continue; // queued until nightfall
    const to = recipientOf(w.contacts);
    if (!to || !w.link) continue; // stays approved until fixed
    const { rows: claimed } = await db.query(`UPDATE consult_text SET status = 'sending' WHERE client_id = $1 AND status = 'approved' RETURNING client_id`, [client_id]);
    if (!claimed.length) continue;
    try {
      const { id } = await messenger.send({ client: w.client, settings: w.settings, to: to.phone.trim(), body: buildConsultText({ client: w.client, link: w.link }) });
      await db.query(`UPDATE consult_text SET status = 'sent', sent_at = now(), to_phone = $2, provider_id = $3, last_error = NULL WHERE client_id = $1`,
        [client_id, to.phone.trim(), id ?? null]);
      sent.push(client_id);
    } catch (e) {
      if (e instanceof ShabbosRefusal) { // the window opened between the check and the send: wait, do not count an attempt
        await db.query(`UPDATE consult_text SET status = 'approved' WHERE client_id = $1`, [client_id]);
        continue;
      }
      await db.query(
        `UPDATE consult_text SET attempts = attempts + 1, last_error = $2, next_attempt_at = $4,
                status = CASE WHEN attempts + 1 >= $3 THEN 'failed' ELSE 'approved' END WHERE client_id = $1`,
        [client_id, String(e.message ?? e).slice(0, 300), MAX_ATTEMPTS, new Date(now().getTime() + RETRY_AFTER_MS)]);
    }
  }
  return sent;
}
