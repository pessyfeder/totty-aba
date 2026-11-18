// Online new-client intake form (SPEC 5.1a). ONE general public page, /intake (no login, no per-client link), follows the BTB
// paper packet: client & family information, contact preferences with text/email consent, informed consent, fee policy,
// session logistics, background, preference assessment, crisis response, release of information (optional) and the NJ / NY
// location & eligibility form. Submit validates the required items and stores the submission. The app then copies it into
// the client's profile: automatically when the link carries the client's id, otherwise it waits for Yisroel to pick
// the client or create one (staff routes below). Typed signatures are stamped with the time of submission.
import { fileURLToPath } from 'node:url';
import { ensureDraft } from './consult-email.js';

const clean = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const GENDERS = ['Male', 'Female', 'Other'];
const STATES = ['NJ', 'NY'];

/** US-friendly phone entry -> E.164, or null when it cannot be one. */
export function normalizePhone(v) {
  const s = clean(v, 40);
  const digits = s.replace(/\D/g, '');
  const e164 = s.startsWith('+') ? `+${digits}` : digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits[0] === '1' ? `+${digits}` : null;
  return e164 && /^\+[1-9][0-9]{6,14}$/.test(e164) ? e164 : null;
}

// ---- The form's fields: only these keys are ever stored ----
const short = (...keys) => Object.fromEntries(keys.map((k) => [k, 200]));
const long = (...keys) => Object.fromEntries(keys.map((k) => [k, 2000]));
export const TEXT = {
  ...short('child_first_name', 'child_last_name', 'parent_name', 'parent_relationship', 'street', 'city', 'zip', 'p2_name', 'p2_relationship',
    'phone', 'email', 'language', 'best_time', 'c2_name', 'c2_contact', 'pay_other', 'frequency',
    'top1', 'top2', 'top3', 'roi_provider', 'roi_contact', 'roi_info',
    'ny_provider', 'ny_license', 'ny_provider_phone',
    'contact_sig', 'consent_sig', 'roi_sig', 'loc_sig'),
  ...long('diagnoses', 'medications', 'providers', 'past_interventions', 'implementers', 'anything_else',
    'fav_toys', 'fav_foods', 'fav_social', 'fav_sensory', 'fav_screen', 'fav_other'),
  ...Object.fromEntries(['nj', 'ny'].flatMap((p) => [1, 2, 3, 4, 5].map((i) => [`${p}_i${i}`, 6]))), // typed initials
};
const BOOL = ['pref_text', 'pref_email', 'pref_call', 'consent_text', 'consent_email', 'consent_ack', 'fee_ack',
  'format_phone', 'format_video', 'crisis_ack'];
const CHOICE = { gender: GENDERS, state: STATES, log_method: ['text', 'email'], pay_due: ['session', 'other'], roi_direction: ['share', 'receive', 'both'] };
const DATES = ['dob', 'ny_dx_date', 'roi_until'];
const SIGS = ['contact_sig', 'consent_sig', 'roi_sig', 'loc_sig'];
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/** Keeps only known keys, trimmed and range-checked. An invalid choice or date becomes empty. */
export function sanitize(input) {
  const b = input && typeof input === 'object' ? input : {};
  const out = {};
  for (const [k, max] of Object.entries(TEXT)) if (k in b) out[k] = clean(b[k], max);
  for (const k of BOOL) if (k in b) out[k] = b[k] === true;
  for (const [k, ok] of Object.entries(CHOICE)) if (k in b) out[k] = ok.includes(b[k]) ? b[k] : '';
  for (const k of DATES) if (k in b) out[k] = isDate(clean(b[k])) ? clean(b[k]) : '';
  return out;
}

const INITIALS = (p) => [1, 2, 3, 4, 5].map((i) => [`${p}_i${i}`, `initials on statement ${i}`]);
/** What Submit needs: [key, label, satisfied?]. The location section depends on the state chosen. */
export function requiredItems(f) {
  const has = (k) => Boolean(f[k]);
  const items = [
    ['child_first_name', "child's first name", has('child_first_name')], ['child_last_name', "child's last name", has('child_last_name')],
    ['dob', "child's date of birth", has('dob')], ['gender', "child's gender", has('gender')],
    ['parent_name', 'your full name', has('parent_name')], ['parent_relationship', 'your relationship to the child', has('parent_relationship')],
    ['street', 'street address', has('street')], ['city', 'city', has('city')], ['state', 'state (New Jersey or New York)', has('state')], ['zip', 'zip code', has('zip')],
    ['phone', 'a valid mobile phone number', Boolean(normalizePhone(f.phone))], ['email', 'a valid email address', EMAIL.test(f.email ?? '')],
    ['log_method', 'how you would like to log goal data', has('log_method')],
    ['consent_text', 'your agreement to receive texts or emails', Boolean(f.consent_text || f.consent_email)],
    ['contact_sig', 'your signature under Consent to Text / Email', has('contact_sig')],
    ['consent_ack', 'your agreement to the Informed Consent for Services', has('consent_ack')], ['consent_sig', 'your signature under Informed Consent', has('consent_sig')],
    ['fee_ack', 'your acknowledgment of the Fee & Cancellation Policy', has('fee_ack')],
    ['crisis_ack', 'your acknowledgment of the Crisis & Emergency Response sheet', has('crisis_ack')],
  ];
  if (f.state) {
    const p = f.state === 'NY' ? 'ny' : 'nj';
    if (p === 'ny') items.push(['ny_provider', 'the diagnosing / ordering provider', has('ny_provider')]);
    for (const [k, label] of INITIALS(p)) items.push([k, `location form: ${label}`, has(k)]);
    items.push(['loc_sig', 'your signature on the Location & Eligibility form', has('loc_sig')]);
  }
  // Release of Information is optional, but once started it must be complete.
  if (['roi_provider', 'roi_contact', 'roi_info', 'roi_until', 'roi_sig', 'roi_direction'].some(has)) {
    items.push(['roi_direction', 'Release of Information: share, receive or both', has('roi_direction')],
      ['roi_provider', 'Release of Information: provider / organization', has('roi_provider')],
      ['roi_sig', 'Release of Information: your signature', has('roi_sig')]);
  }
  return items;
}

const LANGUAGES = { english: 'en', yiddish: 'yi', hebrew: 'he', spanish: 'es', russian: 'ru', french: 'fr' };
const INDEX = fileURLToPath(new URL('../public/index.html', import.meta.url));

/** Copies a stored submission into a client's profile. Fills EMPTY fields only (what Yisroel already entered stays),
 *  keeps the full form on the client, and moves a "reached out" client to "information submitted". Returns whether the status moved. */
export async function importSubmission(db, sub, clientId, at = new Date()) {
  const f = sub.form;
  await db.query(
    `UPDATE client SET intake_form = $2::jsonb, dob = COALESCE(dob, $3::date), gender = COALESCE(gender, $4),
            street_address = COALESCE(NULLIF(street_address, ''), $5), city = COALESCE(NULLIF(city, ''), $6), state = COALESCE(state, $7),
            zip = COALESCE(NULLIF(zip, ''), $8), notes = COALESCE(NULLIF(notes, ''), $9),
            info_submitted_at = COALESCE(info_submitted_at, $10), updated_at = $10 WHERE id = $1`,
    [clientId, JSON.stringify(f), f.dob || null, f.gender || null, f.street || null, f.city || null, f.state || null, f.zip || null, f.anything_else || null, at]);
  const { rows: [contact] } = await db.query('SELECT id FROM contact WHERE client_id = $1 ORDER BY id LIMIT 1', [clientId]);
  const email = EMAIL.test(f.email ?? '') ? f.email : null;
  const language = LANGUAGES[(f.language ?? '').toLowerCase()] ?? null;
  const channel = f.pref_call && !f.pref_text ? 'call' : 'sms';
  const consent = Boolean(f.consent_text && f.contact_sig); // written consent = the box plus the typed signature
  const vals = [f.parent_name, f.parent_relationship || null, normalizePhone(f.phone), email, language, channel, consent, at];
  if (contact) {
    await db.query(
      `UPDATE contact SET relationship = COALESCE(NULLIF(relationship, ''), $2), phone = COALESCE(phone, $3), email = COALESCE(NULLIF(email, ''), $4),
              language = CASE WHEN language = 'en' THEN COALESCE($5, language) ELSE language END,
              consent_given_at = COALESCE(consent_given_at, CASE WHEN $6 THEN $7::timestamptz END) WHERE id = $1`,
      [contact.id, vals[1], vals[2], vals[3], vals[4], vals[6], vals[7]]);
  } else {
    await db.query(
      `INSERT INTO contact (client_id, name, relationship, phone, email, language, preferred_channel, consent_given_at)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'en'), $7, CASE WHEN $8 THEN $9::timestamptz END)`,
      [clientId, ...vals]);
  }
  await db.query('UPDATE intake_submission SET client_id = $2, imported_at = $3 WHERE id = $1', [sub.id, clientId, at]);
  const { rows } = await db.query(`UPDATE client SET intake_status = 'paperwork_received' WHERE id = $1 AND intake_status = 'inquiry' RETURNING id`, [clientId]);
  if (rows.length) await ensureDraft(db, clientId);
  return rows.length > 0;
}

export function infoRoutes({ app, db, now = () => new Date() }) {
  const headers = (res) => res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' });
  const attempts = new Map(); // ip -> {n, resetAt}: the page is public, so submissions are rate limited

  // The page itself is the app's single-page UI; it switches to the public form when the path is /intake.
  app.get('/intake', (req, res) => { headers(res); res.sendFile(INDEX); });

  const clientOf = async (token) => (typeof token === 'string' && token
    ? (await db.query(`SELECT id, first_name, last_name FROM client WHERE info_token = $1 AND status = 'active'`, [token])).rows[0] : undefined);
  // Lets the page pre-fill the child's name when opened from a client's own link.
  app.get('/intake-api/client', async (req, res) => {
    headers(res);
    const c = await clientOf(req.query.c);
    res.json(c ? { first_name: c.first_name, last_name: c.last_name } : {});
  });

  app.post('/intake-api/submit', async (req, res) => {
    headers(res);
    const a = attempts.get(req.ip);
    if (a && a.resetAt > Date.now() && a.n >= 20) return res.status(429).json({ error: 'Too many submissions from this address. Please try again later.' });
    attempts.set(req.ip, { n: a && a.resetAt > Date.now() ? a.n + 1 : 1, resetAt: a?.resetAt > Date.now() ? a.resetAt : Date.now() + 60 * 60e3 });
    const f = sanitize(req.body?.form);
    const missing = requiredItems(f).filter(([, , ok]) => !ok);
    if (missing.length) return res.status(400).json({ error: `Please complete: ${missing.map(([, l]) => l).join('; ')}.`, missing: missing.map(([k]) => k) });
    const at = now();
    f.signed_at = Object.fromEntries(SIGS.filter((k) => f[k]).map((k) => [k, at.toISOString()]));
    const { rows: [sub] } = await db.query(
      `INSERT INTO intake_submission (child_first_name, child_last_name, form, submitted_at) VALUES ($1, $2, $3::jsonb, $4) RETURNING *`,
      [f.child_first_name, f.child_last_name, JSON.stringify(f), at]);
    // The emailed link carries the client's unique link id (?c=<info_token>): that client gets the answers now. Without a valid
    // id (the general link) the form waits for Yisroel (see staff routes).
    const owner = await clientOf(req.body?.client);
    if (owner) await importSubmission(db, sub, owner.id, at);
    res.json({ submitted: true });
  });
}

/** Staff side (after login): submissions not yet copied into a client, and the copy itself. */
export function intakeFormRoutes({ app, db, HttpError, bad, audit, now = () => new Date() }) {
  app.get('/api/intake-submissions', async (req, res) => {
    const { rows } = await db.query(
      `SELECT id, child_first_name, child_last_name, submitted_at, form->>'parent_name' AS parent_name, form->>'state' AS state
         FROM intake_submission WHERE client_id IS NULL ORDER BY submitted_at`);
    for (const r of rows) {
      r.suggested = (await db.query(
        `SELECT id FROM client WHERE clinician_id = $1 AND status = 'active' AND (lower(last_name) = lower($2) OR lower(first_name) = lower($3))`,
        [req.clinician.id, r.child_last_name, r.child_first_name])).rows.map((c) => c.id);
    }
    res.json(rows);
  });

  app.post('/api/intake-submissions/:id/import', async (req, res) => {
    const { rows: [sub] } = await db.query('SELECT * FROM intake_submission WHERE id = $1 AND client_id IS NULL', [req.params.id]);
    if (!sub) throw new HttpError(404, 'Not found');
    let clientId = req.body?.client_id, created = false;
    if (clientId) {
      const { rows } = await db.query('SELECT id FROM client WHERE id = $1 AND clinician_id = $2', [clientId, req.clinician.id]);
      if (!rows.length) throw new HttpError(404, 'Client not found');
    } else if (req.body?.create === true) {
      const me = req.clinician;
      if (me.latitude == null || me.longitude == null) throw bad('Set your own location before creating clients from a form');
      const { rows: [c] } = await db.query(
        `INSERT INTO client (clinician_id, first_name, last_name, admission_date, latitude, longitude, timezone, in_israel)
         VALUES ($1, $2, $3, current_date, $4, $5, $6, $7) RETURNING id`,
        [me.id, sub.child_first_name, sub.child_last_name, me.latitude, me.longitude, me.timezone, me.in_israel]);
      clientId = c.id; created = true;
    } else throw bad('Choose a client, or create a new one');
    const advanced = await importSubmission(db, sub, clientId, now());
    await audit(req, 'import', 'intake_submission', sub.id, { client_id: clientId, created });
    res.json({ client_id: clientId, created, status_advanced: advanced, location_defaulted: created });
  });
}
