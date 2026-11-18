// First reply to a new inquiry (SPEC 5.1a). When a client is at "reached out" (inquiry) the app drafts an email
// carrying the client information form link (Settings → Intake). Totty reviews and approves it; only then is it sent.
// The email holds no clinical detail: the child's first name and the link, nothing else.
// Shabbos / Yom Tov: an approved email waits while the recipient's window is open and goes out afterwards.
import { locationFrom, windowAt } from './shabbos.js';
import { recipientOf } from './consult-email.js';

const MAX_ATTEMPTS = 3;

/** The subject and text of the email. Pure. */
export function buildInquiryEmail({ client, contact, clinician, link }) {
  const sign = clinician.name || 'Your behavior analyst';
  return {
    subject: `Next step for ${client.first_name}: client information form`,
    text: [
      `Hi ${contact.name},`,
      '',
      `Thank you for reaching out about ${client.first_name}. I'd love to help.`,
      '',
      'The next step is a short client information form. Please open the link below and fill in the section that applies to you, New Jersey or New York:',
      '',
      link,
      '',
      "Once I receive it, I'll send you a link to schedule our first consultation.",
      '',
      'If you have any trouble with the form, just reply to this email.',
      '',
      'Warm regards,',
      sign,
    ].join('\n'),
  };
}

/** Creates the draft when the client is at "reached out". Idempotent; never makes a second one. */
export async function ensureDraft(db, clientId) {
  const { rows } = await db.query(
    `INSERT INTO inquiry_email (client_id) SELECT id FROM client WHERE id = $1 AND intake_status = 'inquiry'
     ON CONFLICT (client_id) DO NOTHING RETURNING client_id`, [clientId]);
  return rows.length > 0;
}

async function load(db, clientId) {
  const { rows: [client] } = await db.query(
    `SELECT c.*, cn.name AS clinician_name, cn.settings_json FROM client c JOIN clinician cn ON cn.id = c.clinician_id WHERE c.id = $1`, [clientId]);
  if (!client) return null;
  const { rows: contacts } = await db.query('SELECT * FROM contact WHERE client_id = $1 ORDER BY id', [clientId]);
  return { client, contacts, clinician: { name: client.clinician_name }, link: client.settings_json?.client_info_url ?? '' };
}

/** What Totty reviews: status, recipient, the exact text, and anything that blocks sending. Null when no draft exists. */
export async function preview(db, clientId) {
  const { rows: [row] } = await db.query('SELECT * FROM inquiry_email WHERE client_id = $1', [clientId]);
  if (!row) return null;
  const w = await load(db, clientId);
  const to = recipientOf(w.contacts);
  const problems = [];
  if (!w.link) problems.push('Set the client information form link in Settings first.');
  if (!to) problems.push('Add an email address for a parent or guardian first.');
  const out = { status: row.status, sent_at: row.sent_at, approved_at: row.approved_at, last_error: row.last_error, problems };
  if (row.status === 'sent') return { ...out, to: row.to_email };
  if (to) out.to = to.email.trim();
  if (to && w.link) Object.assign(out, buildInquiryEmail({ client: w.client, contact: to, clinician: w.clinician, link: w.link }));
  return out;
}

/** Totty's approval. Throws a user-facing Error when the email cannot go out yet. */
export async function approve(db, clientId) {
  const p = await preview(db, clientId);
  if (!p) throw new Error('There is no first-reply email for this client');
  if (p.status !== 'pending_approval') throw new Error(`This email is already ${p.status.replace('_', ' ')}`);
  if (p.problems.length) throw new Error(p.problems[0]);
  const { rows } = await db.query(
    `UPDATE inquiry_email SET status = 'approved', approved_at = now()
      WHERE client_id = $1 AND status = 'pending_approval'
        AND EXISTS (SELECT 1 FROM client WHERE id = $1 AND intake_status = 'inquiry') RETURNING client_id`, [clientId]);
  if (!rows.length) throw new Error('The client is no longer at "Reached out", so the email was not approved');
}

/** Totty declines to send it. */
export async function cancel(db, clientId) {
  const { rows } = await db.query(
    `UPDATE inquiry_email SET status = 'cancelled' WHERE client_id = $1 AND status IN ('pending_approval', 'approved') RETURNING client_id`, [clientId]);
  return rows.length > 0;
}

/**
 * Sends every approved email that can go out now (all of them, or one client's). Safe to run on every tick and twice:
 * each row is claimed with a conditional UPDATE first. Returns the client ids that were sent.
 */
export async function sendApproved({ db, mailer, now = () => new Date(), clientId = null }) {
  const { rows } = await db.query(
    `SELECT e.client_id FROM inquiry_email e WHERE e.status = 'approved' AND ($1::uuid IS NULL OR e.client_id = $1) ORDER BY e.approved_at`, [clientId]);
  const sent = [];
  for (const { client_id } of rows) {
    const w = await load(db, client_id);
    if (w.client.intake_status !== 'inquiry') { // moved on (paperwork already sent): no longer needed
      await db.query(`UPDATE inquiry_email SET status = 'cancelled' WHERE client_id = $1 AND status = 'approved'`, [client_id]);
      continue;
    }
    if (windowAt(now(), locationFrom(w.client, w.client.settings_json))) continue; // waits for nightfall
    const to = recipientOf(w.contacts);
    if (!to || !w.link) continue; // stays approved until fixed
    const { rows: claimed } = await db.query(`UPDATE inquiry_email SET status = 'sending' WHERE client_id = $1 AND status = 'approved' RETURNING client_id`, [client_id]);
    if (!claimed.length) continue;
    try {
      const { id } = await mailer.send({ to: to.email.trim(), ...buildInquiryEmail({ client: w.client, contact: to, clinician: w.clinician, link: w.link }) });
      await db.query(`UPDATE inquiry_email SET status = 'sent', sent_at = now(), to_email = $2, provider_id = $3, last_error = NULL WHERE client_id = $1`,
        [client_id, to.email.trim(), id ?? null]);
      sent.push(client_id);
    } catch (e) {
      await db.query(
        `UPDATE inquiry_email SET attempts = attempts + 1, last_error = $2,
                status = CASE WHEN attempts + 1 >= $3 THEN 'failed' ELSE 'approved' END WHERE client_id = $1`,
        [client_id, String(e.message ?? e).slice(0, 300), MAX_ATTEMPTS]);
    }
  }
  return sent;
}
