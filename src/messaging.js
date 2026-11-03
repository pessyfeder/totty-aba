// The only place that dispatches SMS. The Shabbos / Yom Tov rule is enforced here (SPEC 5.3),
// so it holds no matter who calls: scheduler, manual report send, or a re-prompt.
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

/** Twilio-backed provider. Credentials come from the environment, never the repo. */
export async function twilioProvider({ accountSid, authToken, from }) {
  const { default: twilio } = await import('twilio');
  const api = twilio(accountSid, authToken);
  return {
    async send({ to, body }) {
      const msg = await api.messages.create({ to, from, body });
      return { id: msg.sid };
    },
  };
}
