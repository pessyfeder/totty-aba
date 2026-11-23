// Status of every automatic text for one client, for the client page: the consultation text, the next check-in
// text, the latest goal prompt, and a plain reason whenever texts cannot go out. Read-only; sends nothing.
import { locationFrom, windowAt } from './shabbos.js';
import * as consultText from './consult-text.js';
import { CHECKIN_EVERY_DAYS, CHECKIN_FIRST_AFTER_DAYS } from './scheduler.js';

const CONSULT_LABEL = { pending_approval: 'Needs approval', approved: 'Queued', sending: 'Sending', sent: 'Sent', cancelled: 'Declined', failed: 'Failed' };

export async function textStatus(db, clientId, at) {
  const { rows: [client] } = await db.query(
    `SELECT c.*, cn.settings_json FROM client c JOIN clinician cn ON cn.id = c.clinician_id WHERE c.id = $1`, [clientId]);
  if (!client) return null;
  const { rows: contacts } = await db.query('SELECT * FROM contact WHERE client_id = $1 ORDER BY id', [clientId]);
  const settings = client.settings_json;

  // Reasons texts cannot go out right now.
  const reasons = [];
  if (client.status === 'archived') reasons.push('This client is archived: no texts go out.');
  for (const c of contacts) {
    if (c.status !== 'active') reasons.push(`${c.name} is ${c.status}: no texts go to them.`);
    else if (!c.phone || !String(c.phone).trim()) reasons.push(`${c.name} has no mobile number.`);
    else if (!c.consent_given_at) reasons.push(`No text consent is recorded for ${c.name}.`);
  }
  if (!contacts.length) reasons.push('There is no contact to text yet.');
  const win = windowAt(at, locationFrom(client, settings));
  const shabbos = win ? { kind: win.kind, end: win.end } : null;
  if (win) reasons.push(`${win.kind === 'yom_tov' ? 'Yom Tov' : 'Shabbos'} window: texts wait until it ends.`);

  // Consultation text.
  const ct = await consultText.preview(db, clientId, () => at);
  const consult = ct && { status: ct.status, label: CONSULT_LABEL[ct.status] ?? ct.status, to: ct.to ?? null, sent_at: ct.sent_at, queued_until: ct.queued_until ?? null, problems: ct.problems, last_error: ct.last_error };

  // Next check-in text: one entry per contact who could get one (same rules as the scheduler).
  const started = ['baseline', 'active'].includes(client.intake_status);
  const checkins = contacts.filter((c) => c.status === 'active' && c.consent_given_at && (c.logging_method === 'paper' ? c.email && String(c.email).trim() : c.phone)).map((c) => {
    const base = { contact: c.name, last_sent_at: c.checkin_last_sent_at, method: c.logging_method === 'paper' ? 'email' : 'text' };
    if (c.logging_method === 'paper') { // paper log: weekly email, always with the link (SPEC 5.7a)
      if (!started) return { ...base, state: 'not_started', note: 'Check-in emails start once baseline begins.' };
      const anchor = Math.max(...[c.checkin_last_sent_at, c.logging_method_changed_at, client.baseline_started_at].filter(Boolean).map((d) => new Date(d).getTime()));
      const note = settings.checkin_booking_url ? '' : 'Set the check-in booking link in Settings: nothing is sent without it.';
      return { ...base, state: 'due', due_at: new Date(anchor + CHECKIN_EVERY_DAYS * 864e5), carries_link: true, note };
    }
    if (!started) return { ...base, state: 'not_started', note: 'Check-in texts start once baseline begins.' };
    if (!c.first_message_at) return { ...base, state: 'waiting', note: `Due ${CHECKIN_FIRST_AFTER_DAYS} days after the first goal prompt is sent.` };
    const dueAt = c.checkin_last_sent_at
      ? new Date(new Date(c.checkin_last_sent_at).getTime() + CHECKIN_EVERY_DAYS * 864e5)
      : new Date(new Date(c.first_message_at).getTime() + CHECKIN_FIRST_AFTER_DAYS * 864e5);
    const note = [];
    if (!settings.checkin_booking_url) note.push('Set the check-in booking link in Settings: nothing is sent without it.');
    note.push('Carries the booking link only if every prompt in the last 7 days was answered; otherwise it asks the parent to reach out.');
    return { ...base, state: 'due', due_at: dueAt, carries_link: null, note: note.join(' ') };
  });

  // Latest goal prompt (the Today and response-log sections hold the detail).
  const { rows: [lastPrompt] } = await db.query(
    `SELECT p.scheduled_for, p.status, g.title FROM prompt p JOIN goal g ON g.id = p.goal_id
      WHERE g.client_id = $1 AND p.scheduled_for <= $2 ORDER BY p.scheduled_for DESC LIMIT 1`, [clientId, at]);

  return { client_status: client.status, intake_status: client.intake_status, reasons, shabbos, consult, checkins, last_prompt: lastPrompt ?? null };
}
