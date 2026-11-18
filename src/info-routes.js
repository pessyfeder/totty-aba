// Parents' Profile page (SPEC 5.1a). The "reached out" email links to /info/<token>: an unguessable per-client link
// (no login) that opens the app's own Profile page for that client. Entries are saved as the parent types, so
// Yisroel sees them right away; Submit checks the required fields and moves the client to "information submitted".
import { fileURLToPath } from 'node:url';
import { ensureDraft } from './consult-email.js';

const clean = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const GENDERS = ['Male', 'Female', 'Other'];
const INDEX = fileURLToPath(new URL('../public/index.html', import.meta.url));

/** US-friendly phone entry -> E.164, or null when it cannot be one. */
export function normalizePhone(v) {
  const s = clean(v, 40);
  const digits = s.replace(/\D/g, '');
  const e164 = s.startsWith('+') ? `+${digits}` : digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits[0] === '1' ? `+${digits}` : null;
  return e164 && /^\+[1-9][0-9]{6,14}$/.test(e164) ? e164 : null;
}

const REQUIRED = [
  ['dob', "child's date of birth"], ['gender', "child's gender"], ['name', 'your name'], ['relationship', 'your relationship to the child'],
  ['phone', 'a valid mobile phone number'], ['email', 'a valid email address'], ['consent', 'your agreement to receive text messages'],
];

export function infoRoutes({ app, db, now = () => new Date() }) {
  const find = async (token) => {
    const { rows } = await db.query(
      `SELECT c.id, c.first_name, c.last_name, c.dob::text AS dob, c.gender, c.notes, c.intake_status, c.info_submitted_at, cn.name AS clinician_name
         FROM client c JOIN clinician cn ON cn.id = c.clinician_id WHERE c.info_token = $1 AND c.status = 'active'`, [String(token)]);
    return rows[0];
  };
  const contactOf = async (id) => (await db.query('SELECT * FROM contact WHERE client_id = $1 ORDER BY id LIMIT 1', [id])).rows[0];
  const headers = (res) => res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' });
  const view = async (c) => {
    const p = await contactOf(c.id);
    return {
      child: { first_name: c.first_name, last_name: c.last_name }, clinician: c.clinician_name, submitted_at: c.info_submitted_at,
      dob: c.dob, gender: c.gender, notes: c.notes,
      parent: { name: p?.name ?? '', relationship: p?.relationship ?? '', phone: p?.phone ?? '', email: p?.email ?? '', consent: Boolean(p?.consent_given_at) },
    };
  };
  const wrap = (fn) => async (req, res) => {
    headers(res);
    const c = await find(req.params.token);
    if (!c) return res.status(404).json({ error: 'This link is not valid. Please ask your behavior analyst for a new one.' });
    return fn(req, res, c);
  };

  // The page itself is the app's single-page UI; it switches to the parent view when the path is /info/<token>.
  app.get('/info/:token', async (req, res) => {
    headers(res);
    res.status((await find(req.params.token)) ? 200 : 404).sendFile(INDEX);
  });
  app.get('/info-api/:token', wrap(async (req, res, c) => res.json(await view(c))));

  /** Saves what is valid so far (draft) — nothing here changes the client's status. */
  async function save(c, b) {
    const dob = /^\d{4}-\d{2}-\d{2}$/.test(clean(b.dob)) && !Number.isNaN(Date.parse(clean(b.dob))) ? clean(b.dob) : null;
    const gender = GENDERS.includes(b.gender) ? b.gender : null;
    await db.query(
      `UPDATE client SET dob = $2::date, gender = $3, notes = $4, updated_at = $5 WHERE id = $1`,
      [c.id, dob, gender, clean(b.notes, 2000) || null, now()]);
    const p = b.parent ?? {};
    const contact = await contactOf(c.id);
    const name = clean(p.name, 200);
    const email = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean(p.email, 200)) ? clean(p.email, 200) : null;
    const f = { name, relationship: clean(p.relationship, 100) || null, phone: normalizePhone(p.phone), email, consent: p.consent === true };
    if (contact) {
      await db.query(
        `UPDATE contact SET name = COALESCE(NULLIF($2, ''), name), relationship = $3, phone = $4, email = $5,
                consent_given_at = CASE WHEN $6 THEN COALESCE(consent_given_at, $7) ELSE NULL END WHERE id = $1`,
        [contact.id, f.name, f.relationship, f.phone, f.email, f.consent, now()]);
    } else if (name) {
      await db.query(
        `INSERT INTO contact (client_id, name, relationship, phone, email, consent_given_at) VALUES ($1, $2, $3, $4, $5, $6)`,
        [c.id, name, f.relationship, f.phone, f.email, f.consent ? now() : null]);
    }
  }

  app.put('/info-api/:token', wrap(async (req, res, c) => {
    await save(c, req.body ?? {});
    res.json({ saved: true });
  }));

  app.post('/info-api/:token/submit', wrap(async (req, res, c) => {
    const b = req.body ?? {}, p = b.parent ?? {};
    const have = { dob: /^\d{4}-\d{2}-\d{2}$/.test(clean(b.dob)), gender: GENDERS.includes(b.gender), name: clean(p.name), relationship: clean(p.relationship),
      phone: normalizePhone(p.phone), email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean(p.email)), consent: p.consent === true };
    const missing = REQUIRED.filter(([k]) => !have[k]).map(([, label]) => label);
    if (missing.length) return res.status(400).json({ error: `Please fill in: ${missing.join('; ')}.`, missing: REQUIRED.filter(([k]) => !have[k]).map(([k]) => k) });
    await save(c, b);
    await db.query('UPDATE client SET info_submitted_at = COALESCE(info_submitted_at, $2), updated_at = $2 WHERE id = $1', [c.id, now()]);
    const { rows } = await db.query(`UPDATE client SET intake_status = 'paperwork_received' WHERE id = $1 AND intake_status = 'inquiry' RETURNING id`, [c.id]);
    if (rows.length) await ensureDraft(db, c.id);
    res.json({ submitted: true });
  }));
}
