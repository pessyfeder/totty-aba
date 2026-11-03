// Dashboard data (SPEC 5.7): client cards, today's prompts, unparsed queue, Shabbos window, attention flags.
import { locationFrom, nextWindow } from './shabbos.js';

const MISSED_THRESHOLD = 3; // no_response prompts in the last 7 days that flag a client

export async function loadDashboard(db, clinician, at) {
  const { rows: clients } = await db.query(
    `SELECT c.id, c.first_name, c.last_name,
            (SELECT COALESCE(json_agg(json_build_object('id', i.id, 'name', i.name, 'note', i.note) ORDER BY i.name), '[]'::json)
               FROM incentive i WHERE i.client_id = c.id) AS incentives,
            (SELECT count(*)::int FROM prompt p JOIN goal g ON g.id = p.goal_id
              WHERE g.client_id = c.id AND p.status = 'no_response'
                AND p.scheduled_for > $2::timestamptz - interval '7 days') AS missed_7d,
            (SELECT count(*)::int FROM response r JOIN prompt p ON p.id = r.prompt_id JOIN goal g ON g.id = p.goal_id
              WHERE g.client_id = c.id AND r.parse_status = 'unparsed') AS unparsed
       FROM client c
      WHERE c.clinician_id = $1 AND c.status = 'active'
      ORDER BY lower(c.last_name), lower(c.first_name)`,
    [clinician.id, at],
  );
  for (const c of clients) {
    c.attention = [];
    if (c.missed_7d >= MISSED_THRESHOLD) c.attention.push(`${c.missed_7d} missed responses in the last 7 days`);
    if (c.unparsed > 0) c.attention.push(c.unparsed === 1 ? '1 reply needs review' : `${c.unparsed} replies need review`);
  }

  const { rows: today } = await db.query(
    `SELECT p.id, p.scheduled_for, p.status, p.deferred_reason, g.title, c.id AS client_id, c.first_name
       FROM prompt p
       JOIN goal g ON g.id = p.goal_id
       JOIN client c ON c.id = g.client_id
      WHERE c.clinician_id = $1
        AND p.prompt_date = ($2::timestamptz AT TIME ZONE c.timezone)::date
      ORDER BY p.scheduled_for, c.last_name`,
    [clinician.id, at],
  );

  const { rows: unparsed } = await db.query(
    `SELECT r.id, r.raw_text, r.received_at, g.title, g.response_type, c.id AS client_id, c.first_name
       FROM response r
       JOIN prompt p ON p.id = r.prompt_id
       JOIN goal g ON g.id = p.goal_id
       JOIN client c ON c.id = g.client_id
      WHERE c.clinician_id = $1 AND r.parse_status = 'unparsed'
      ORDER BY r.received_at`,
    [clinician.id],
  );

  const win = nextWindow(at, locationFrom(clinician, clinician.settings_json));
  return {
    clients,
    today,
    unparsed,
    attention: clients.filter((c) => c.attention.length),
    shabbos: win && { kind: win.kind, start: win.start, end: win.end, active: win.start <= at },
  };
}
