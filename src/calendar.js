// Read-only Google Calendar sync (SPEC 5.7b). Reads the calendar's secret iCal feed; never writes to it.
// Events become appointments (source = 'calendar_sync'), matched to a client by attendee email against contact emails.
import { Luxon } from 'kosher-zmanim';

const { DateTime } = Luxon;
const FEED_HOSTS = ['calendar.google.com'];

/** Validate the stored feed address: https on Google's host only (webcal:// is accepted and converted). */
export function normalizeFeedUrl(raw) {
  let u;
  try { u = new URL(String(raw).trim().replace(/^webcal:/i, 'https:')); } catch { return null; }
  return u.protocol === 'https:' && FEED_HOSTS.includes(u.hostname) ? u.href : null;
}

export function appointmentType(title = '') {
  const t = title.toLowerCase();
  if (/consult/.test(t)) return 'consultation';
  if (/check[\s-]?in/.test(t)) return 'check-in';
  return 'ongoing meeting';
}

const unescape_ = (s) => s.replace(/\\([nN,;\\])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));

function when(value, params) {
  if (/^\d{8}$/.test(value)) return DateTime.fromFormat(value, 'yyyyMMdd', { zone: params.TZID || 'utc' });
  const utc = value.endsWith('Z');
  const dt = DateTime.fromFormat(value.replace(/Z$/, ''), "yyyyMMdd'T'HHmmss", { zone: utc ? 'utc' : params.TZID || 'utc' });
  return dt;
}

/** Parse an iCal feed into events. Recurring events (RRULE) are skipped: bookings are single events. */
export function parseIcs(text) {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = { attendees: [] }; continue; }
    if (line === 'END:VEVENT') {
      if (cur?.uid && cur.start?.isValid && !cur.recurring) {
        events.push({
          uid: cur.uid, title: cur.title ?? '', description: cur.description ?? '',
          start: cur.start.toJSDate(), end: cur.end?.isValid ? cur.end.toJSDate() : null,
          cancelled: cur.status === 'CANCELLED', attendees: cur.attendees,
        });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const [name, ...rest] = line.slice(0, i).split(';');
    const params = Object.fromEntries(rest.map((p) => { const [k, ...v] = p.split('='); return [k.toUpperCase(), v.join('=').replace(/^"|"$/g, '')]; }));
    const value = line.slice(i + 1);
    switch (name.toUpperCase()) {
      case 'UID': cur.uid = value; break;
      case 'SUMMARY': cur.title = unescape_(value); break;
      case 'DESCRIPTION': cur.description = unescape_(value); break;
      case 'STATUS': cur.status = value.toUpperCase(); break;
      case 'DTSTART': cur.start = when(value, params); break;
      case 'DTEND': cur.end = when(value, params); break;
      case 'RRULE': cur.recurring = true; break;
      case 'ATTENDEE': case 'ORGANIZER': {
        const m = value.match(/^mailto:(.+)$/i);
        if (m) cur.attendees.push(m[1].trim().toLowerCase());
        break;
      }
      default:
    }
  }
  return events;
}

/**
 * Sync one clinician's calendar. Idempotent. Returns counts.
 * `fetchText(url)` is injectable for tests. Unmatched events are stored with client_id NULL and linked later.
 */
export async function syncCalendar({ db, clinician, fetchText, now = () => new Date() }) {
  const url = normalizeFeedUrl(clinician.settings_json?.calendar_ics_url ?? '');
  if (!url) return { skipped: true };
  const events = parseIcs(await fetchText(url));
  const own = (clinician.email ?? '').toLowerCase();

  const { rows: contacts } = await db.query(
    `SELECT lower(c.email) AS email, c.client_id FROM contact c
       JOIN client cl ON cl.id = c.client_id
      WHERE cl.clinician_id = $1 AND c.email IS NOT NULL`, [clinician.id]);
  const clientByEmail = new Map(contacts.map((c) => [c.email, c.client_id]));

  let created = 0, updated = 0;
  const seen = [];
  for (const ev of events) {
    seen.push(ev.uid);
    const emails = [...new Set(ev.attendees)].filter((e) => e !== own);
    const clientId = emails.map((e) => clientByEmail.get(e)).find(Boolean) ?? null;
    const status = ev.cancelled ? 'cancelled' : 'scheduled';
    const { rows: [row] } = await db.query(
      `INSERT INTO appointment (clinician_id, client_id, external_id, type, starts_at, ends_at, status, title, attendee_emails)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (clinician_id, external_id) DO UPDATE
         SET client_id = COALESCE(EXCLUDED.client_id, appointment.client_id), type = EXCLUDED.type,
             starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at, status = EXCLUDED.status,
             title = EXCLUDED.title, attendee_emails = EXCLUDED.attendee_emails, updated_at = $10
         WHERE (appointment.client_id, appointment.type, appointment.starts_at, appointment.ends_at, appointment.status, appointment.title, appointment.attendee_emails)
               IS DISTINCT FROM (COALESCE(EXCLUDED.client_id, appointment.client_id), EXCLUDED.type, EXCLUDED.starts_at, EXCLUDED.ends_at, EXCLUDED.status, EXCLUDED.title, EXCLUDED.attendee_emails)
       RETURNING (xmax = 0) AS inserted`,
      [clinician.id, clientId, ev.uid, appointmentType(ev.title), ev.start, ev.end, status, ev.title, emails, now()]);
    if (row?.inserted) created++; else if (row) updated++;
  }

  // A future event that vanished from the feed was deleted in the calendar: mark it cancelled.
  const res = await db.query(
    `UPDATE appointment SET status = 'cancelled', updated_at = $4
      WHERE clinician_id = $1 AND source = 'calendar_sync' AND status = 'scheduled'
        AND starts_at > $3 AND NOT (external_id = ANY($2::text[]))`,
    [clinician.id, seen, now(), now()]);
  return { created, updated, cancelled: res.affectedRows ?? res.rowCount ?? 0, events: events.length };
}

export async function syncAll({ db, fetchText, now }) {
  const { rows } = await db.query(`SELECT id, email, settings_json FROM clinician WHERE settings_json ? 'calendar_ics_url'`);
  const out = [];
  for (const c of rows) {
    try { out.push(await syncCalendar({ db, clinician: c, fetchText, now })); }
    catch (err) { console.error('calendar sync failed:', err.message); out.push({ error: err.message }); }
  }
  return out;
}

export const httpFetchText = async (url) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: 'error' });
  if (!r.ok) throw new Error(`calendar feed returned ${r.status}`);
  return r.text();
};
