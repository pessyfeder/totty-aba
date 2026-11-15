// The only place that dispatches SMS. The Shabbos / Yom Tov rule is enforced here (SPEC 5.3),
// so it holds no matter who calls: scheduler, manual report send, or a re-prompt.
import { createPublicKey, verify } from 'node:crypto';
import { locationFrom, windowAt } from './shabbos.js';

export class ShabbosRefusal extends Error {
  constructor(window) {
    super(`Send refused: ${window.kind} window until ${window.end.toISOString()}`);
    this.name = 'ShabbosRefusal';
    this.window = window;
  }
}

/**
 * @param {object} deps
 * @param {{query: Function}} deps.db
 * @param {{send: (m: {to: string, body: string}) => Promise<{id: string}>}} deps.provider
 * @param {() => Date} [deps.now]
 */
export function createMessenger({ db, provider, now = () => new Date() }) {
  /**
   * @param {object} m
   * @param {object} m.client  client row (location columns) of the recipient
   * @param {object} m.settings clinician settings_json
   * @param {string} m.to E.164 number
   * @param {string} m.body
   * @throws {ShabbosRefusal} when called inside a blocked window. The attempt is logged.
   */
  async function send({ client, settings, to, body, promptId = null, reportId = null }) {
    const window = windowAt(now(), locationFrom(client, settings));
    if (window) {
      await db.query(
        `INSERT INTO message_log (direction, to_from, body, status, refusal_reason, prompt_id, report_id)
         VALUES ('outbound', $1, $2, 'refused', $3, $4, $5)`,
        [to, body, `${window.kind} until ${window.end.toISOString()}`, promptId, reportId],
      );
      throw new ShabbosRefusal(window);
    }
    const { id } = await provider.send({ to, body });
    await db.query(
      `INSERT INTO message_log (direction, to_from, body, provider_id, status, prompt_id, report_id)
       VALUES ('outbound', $1, $2, $3, 'sent', $4, $5)`,
      [to, body, id, promptId, reportId],
    );
    return { id };
  }

  return { send };
}

/** Logs instead of sending. Default in development. */
export function consoleProvider(log = console.log) {
  let n = 0;
  return {
    async send({ to, body }) {
      log(`[sms -> ${to}] ${body}`);
      return { id: `dev-${Date.now()}-${n++}` };
    },
  };
}

/** Telnyx-backed provider (v2 Messages API). Credentials come from the environment, never the repo. */
export function telnyxProvider({ apiKey, from, messagingProfileId, fetchImpl = fetch }) {
  return {
    async send({ to, body }) {
      const res = await fetchImpl('https://api.telnyx.com/v2/messages', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to, text: body, ...(messagingProfileId ? { messaging_profile_id: messagingProfileId } : {}) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Telnyx send failed (${res.status}): ${json.errors?.[0]?.detail ?? 'unknown error'}`);
      return { id: json.data.id };
    },
  };
}

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/**
 * Verifies a Telnyx webhook: an Ed25519 signature over `${timestamp}|${rawBody}`, using the
 * account's public key (base64, from the Telnyx portal). Rejects timestamps more than 5 minutes off.
 */
export function verifyTelnyxSignature({ publicKey, signature, timestamp, rawBody, now = new Date() }) {
  if (!publicKey || !signature || !timestamp || rawBody == null) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now.getTime() / 1000 - ts) > 300) return false;
  try {
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKey, 'base64')]), format: 'der', type: 'spki' });
    return verify(null, Buffer.from(`${timestamp}|${rawBody}`), key, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}
