// Dashboard data (SPEC 5.7): client cards, today's prompts, Shabbos window, attention flags.
import { locationFrom, nextWindow } from './shabbos.js';

const MISSED_THRESHOLD = 3; // no_response prompts in the last 14 days that flag a client

export async function loadDashboard(db, clinician, at) {
  const { rows: clients } = await db.query(
    `SELECT c.id, c.first_name, c.last_name,
            (SELECT COALESCE(json_agg(json_build_object('id', i.id, 'name', i.name, 'note', i.note) ORDER BY i.name), '[]'::json)
               FROM reinforcement i WHERE i.client_id = c.id) AS reinforcements,
            (SELECT count(*)::int FROM prompt p JOIN goal g ON g.id = p.goal_id
              WHERE g.client_id = c.id AND p.status = 'no_response'
                AND p.scheduled_for > $2::timestamptz - interval '14 days') AS missed_14d
       FROM client c
      WHERE c.clinician_id = $1 AND c.status = 'active'
      ORDER BY lower(c.last_name), lower(c.first_name)`,
    [clinician.id, at],
  );
  for (const c of clients) {
    c.attention = [];
    if (c.missed_14d >= MISSED_THRESHOLD) c.attention.push(`${c.missed_14d} missed responses in the last 14 days`);
  }
  // Consultation emails waiting for Totty's approval (SPEC 5.7b). These clients are not active yet, so they
  // are listed apart from the client cards.
  const { rows: toApprove } = await db.query(
    `SELECT c.id, c.first_name, c.last_name FROM consult_email e JOIN client c ON c.id = e.client_id
      WHERE c.clinician_id = $1 AND e.status = 'pending_approval' AND c.intake_status = 'paperwork_received'
      ORDER BY e.created_at`, [clinician.id]);

  const { rows: today } = await db.query(
    `SELECT p.id, p.scheduled_for, p.status, p.deferred_reason, g.title, g.response_type, r.value_bool, r.value_minutes,
            c.id AS client_id, c.first_name
       FROM prompt p
       JOIN goal g ON g.id = p.goal_id
       JOIN client c ON c.id = g.client_id
       LEFT JOIN LATERAL (SELECT * FROM response WHERE prompt_id = p.id AND parse_status <> 'unparsed' ORDER BY received_at DESC LIMIT 1) r ON true
      WHERE c.clinician_id = $1
        AND p.prompt_date = ($2::timestamptz AT TIME ZONE c.timezone)::date
      ORDER BY p.scheduled_for, c.last_name`,
    [clinician.id, at],
  );

  const { rows: appointments } = await db.query(
    `SELECT a.id, a.client_id, a.type, a.starts_at, c.first_name, c.last_name
       FROM appointment a LEFT JOIN client c ON c.id = a.client_id
      WHERE a.clinician_id = $1 AND a.status = 'scheduled' AND a.starts_at >= $2
      ORDER BY a.starts_at LIMIT 20`, [clinician.id, at]);

  const win = nextWindow(at, locationFrom(clinician, clinician.settings_json));
  return {
    clients,
    today,
    appointments,
    emailsToApprove: toApprove,
    attention: clients.filter((c) => c.attention.length),
    shabbos: win && { kind: win.kind, start: win.start, end: win.end, active: win.start <= at },
  };
}
