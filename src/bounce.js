// Email bounce handling (SPEC 5.4b B): "An email that bounces is flagged on the contact."
// Two sources feed the same flag: a hard rejection thrown at send time, and the provider's bounce webhook.
// Only permanent (hard) bounces flag a contact; soft bounces (mailbox full, temporary failure) are logged only.
import { timingSafeEqual } from 'node:crypto';

const norm = (e) => String(e ?? '').trim().toLowerCase();

/** True when an SMTP send error is a permanent rejection of the recipient (5xx), not a transient failure. */
export function isHardRejection(err) {
  const code = Number(err?.responseCode);
  return (code >= 500 && code < 600) || (Array.isArray(err?.rejected) && err.rejected.length > 0);
}

/**
 * Flags every contact with this address. Returns how many contacts were flagged.
 * Logged in the message log either way, so Totty can see what happened.
 */
export async function flagBounce({ db, email, reason = null, at = new Date(), hard = true }) {
  const addr = norm(email);
  if (!addr) return 0;
  await db.query(
    `INSERT INTO message_log (direction, to_from, body, status) VALUES ('inbound', $1, $2, $3)`,
    [addr, reason ? String(reason).slice(0, 300) : null, hard ? 'bounced' : 'soft_bounce'],
  );
  if (!hard) return 0;
  const { rows } = await db.query(
    `UPDATE contact SET email_bounced_at = $2, email_bounce_reason = $3
      WHERE lower(btrim(email)) = $1 RETURNING id`,
    [addr, at, reason ? String(reason).slice(0, 300) : null],
  );
  return rows.length;
}

/** Wraps a mailer so a hard SMTP rejection flags the recipient's contact, then rethrows for the caller's own retry logic. */
export function withBounceFlagging(mailer, db) {
  return {
    async send(m) {
      try {
        return await mailer.send(m);
      } catch (err) {
        if (isHardRejection(err)) await flagBounce({ db, email: m.to, reason: err.message }).catch(() => {});
        throw err;
      }
    },
  };
}

/** Called when an email is edited: a new address starts with a clean slate. */
export async function clearIfEmailChanged({ db, contactId, previousEmail, nextEmail }) {
  if (norm(previousEmail) === norm(nextEmail)) return false;
  await db.query(`UPDATE contact SET email_bounced_at = NULL, email_bounce_reason = NULL WHERE id = $1`, [contactId]);
  return true;
}

/**
 * Normalizes a bounce webhook body into [{email, hard, reason}]. Understands:
 *  - generic:  {email, type: 'hard'|'soft', reason}   (or an array of those)
 *  - Postmark: {RecordType: 'Bounce', Type: 'HardBounce'|..., Email, Description}
 *  - SendGrid: [{event: 'bounce'|'dropped', email, type: 'bounce'|'blocked', reason}]
 */
export function parseBounceEvents(body) {
  const items = Array.isArray(body) ? body : body ? [body] : [];
  const out = [];
  for (const x of items) {
    if (!x || typeof x !== 'object') continue;
    if (x.RecordType === 'Bounce' || x.Email) { // Postmark
      const t = String(x.Type ?? '');
      out.push({ email: x.Email, hard: /^(HardBounce|BadEmailAddress|Blocked|ManuallyDeactivated)$/i.test(t), reason: x.Description ?? t });
    } else if (x.event === 'bounce' || x.event === 'dropped') { // SendGrid ("blocked" bounces are temporary)
      out.push({ email: x.email, hard: x.event === 'dropped' || x.type !== 'blocked', reason: x.reason ?? x.event });
    } else if (x.email && x.type) { // generic
      out.push({ email: x.email, hard: String(x.type).toLowerCase() !== 'soft', reason: x.reason ?? null });
    }
  }
  return out.filter((e) => norm(e.email));
}

/** Constant-time check of the shared secret. No secret configured means the webhook is off. */
export function secretMatches(expected, given) {
  if (!expected || !given) return false;
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(given));
  return a.length === b.length && timingSafeEqual(a, b);
}
