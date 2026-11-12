// Dashboard data (SPEC 5.7): client cards, today's prompts, Shabbos window, attention flags.
import { locationFrom, nextWindow } from './shabbos.js';

const MISSED_THRESHOLD = 3; // no_response prompts in the last 7 days that flag a client

export async function loadDashboard(db, clinician, at) {
  const { rows: clients } = await db.query(
    `SELECT c.id, c.first_name, c.last_name,
            (SELECT COALESCE(json_agg(json_build_object('id', i.id, 'name', i.name, 'note', i.note) ORDER BY i.name), '[]'::json)
               FROM reinforcement i WHERE i.client_id = c.id) AS reinforcements,
            (SELECT count(*)::int FROM prompt p JOIN goal g ON g.id = p.goal_id
              WHERE g.client_id = c.id AND p.status = 'no_response'
                AND p.scheduled_for > $2::timestamptz - interval '7 days') AS missed_7d
       FROM client c
      WHERE c.clinician_id = $1 AND c.status = 'active'
      ORDER BY lower(c.last_name), lower(c.first_name)`,
    [clinician.id, at],
  );
  for (const c of clients) {
    c.attention = [];
    if (c.missed_7d >= MISSED_THRESHOLD) c.attention.push(`${c.missed_7d} missed responses in the last 7 days`);
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

  const win = nextWindow(at, locationFrom(clinician, clinician.settings_json));
  return {
    clients,
    today,
    attention: clients.filter((c) => c.attention.length),
    shabbos: win && { kind: win.kind, start: win.start, end: win.end, active: win.start <= at },
  };
}
