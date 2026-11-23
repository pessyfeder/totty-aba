// Online new-client intake form (SPEC 5.1a). ONE general public page, /intake (no login, no per-client link), follows the BTB
// paper packet: client & family information, contact preferences with text/email consent, informed consent, fee policy,
// session logistics, background, preference assessment, release of information (optional) and the NJ / NY
// location & eligibility form. Submit validates the required items (every signed consent among them) and CREATES THE CLIENT
// (status "information submitted") with its parent contact(s) and the recorded consent, then drafts the consultation email for
// Totty's approval. Typed signatures are stamped with the time of submission. Nothing is contacted automatically.
import { fileURLToPath } from 'node:url';
import { ensureDraft } from './consult-email.js';
import { ensureDraft as ensureTextDraft } from './consult-text.js';

const clean = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const GENDERS = ['Male', 'Female'];
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
    'phone', 'email', 'p2_phone', 'p2_email', 'language', 'pay_other',
    'top1', 'top2', 'top3', 'roi_provider', 'roi_contact', 'roi_info',
    'ny_provider', 'ny_license', 'ny_provider_phone',
    'consent_sig', 'roi_sig', 'loc_sig'),
  ...long('diagnoses', 'medications', 'providers', 'past_interventions', 'implementers', 'anything_else',
    'fav_toys', 'fav_foods', 'fav_social', 'fav_sensory', 'fav_screen', 'fav_other'),
  ...Object.fromEntries(['nj', 'ny'].flatMap((p) => [1, 2, 3, 4, 5].map((i) => [`${p}_i${i}`, 6]))), // typed initials
};
const BOOL = ['pref_text', 'pref_email', 'pref_call', 'p2_pref_text', 'p2_pref_email', 'p2_pref_call', 'text_consent', 'p2_text_consent', 'consent_ack', 'fee_ack'];
const CHOICE = { gender: GENDERS, state: STATES, pay_due: ['session', 'other'], roi_direction: ['share', 'receive', 'both'] };
const DATES = ['dob', 'ny_dx_date', 'roi_until'];
const SIGS = ['consent_sig', 'roi_sig', 'loc_sig'];
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
    ['consent_ack', 'your agreement to the Informed Consent for Services', has('consent_ack')], ['consent_sig', 'your signature under Informed Consent', has('consent_sig')],
    ['fee_ack', 'your acknowledgment of the Fee & Cancellation Policy', has('fee_ack')],
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

/**
 * Creates the client from a validated, sanitised form. Returns the new client id.
 * The form carries no coordinates or timezone, so the client starts with the clinician's own (they drive the Shabbos window,
 * SPEC 5.3); Totty can set the family's real location by editing the client.
 */
export async function createClientFromForm(db, clinician, f, at) {
  const place = [f.city, f.state].filter(Boolean).join(', ');
  const { rows: [c] } = await db.query(
    `INSERT INTO client (clinician_id, first_name, last_name, gender, dob, admission_date, notes, location_name, street_address, city, state, zip,
                         latitude, longitude, timezone, in_israel, intake_status, intake_form, info_submitted_at, consent_signed_at, consent_signed_by)
     VALUES ($1, $2, $3, $4, $5, $6::timestamptz::date, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'paperwork_received', $17::jsonb, $6, $6, $18) RETURNING id`,
    [clinician.id, f.child_first_name, f.child_last_name, f.gender || null, f.dob || null, at, f.anything_else || null, place || null, f.street || null, f.city || null,
      f.state || null, f.zip || null, clinician.latitude, clinician.longitude, clinician.timezone, Boolean(clinician.in_israel), JSON.stringify(f), f.consent_sig]);
  try {
    // Text consent is the parent's own tick on the form (optional); otherwise Totty records it on the contact at the consultation.
    const CONSENT_NOTE = 'Agreed to receive texts on the online intake form';
    await db.query(
      `INSERT INTO contact (client_id, name, relationship, phone, email, language, preferred_channel, consent_given_at, consent_note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [c.id, f.parent_name, f.parent_relationship || null, normalizePhone(f.phone), f.email, LANGUAGES[(f.language ?? '').toLowerCase()] ?? 'en',
        f.pref_call && !f.pref_text ? 'call' : 'sms', f.text_consent ? at : null, f.text_consent ? CONSENT_NOTE : null]);
    if (f.p2_name) {
      await db.query(
        `INSERT INTO contact (client_id, name, relationship, phone, email, language, preferred_channel, consent_given_at, consent_note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [c.id, f.p2_name, f.p2_relationship || null, normalizePhone(f.p2_phone), f.p2_email || null, LANGUAGES[(f.language ?? '').toLowerCase()] ?? 'en',
          f.p2_pref_call && !f.p2_pref_text ? 'call' : 'sms', f.p2_text_consent && f.p2_phone ? at : null, f.p2_text_consent && f.p2_phone ? CONSENT_NOTE : null]);
    }
    await ensureDraft(db, c.id);
    await ensureTextDraft(db, c.id);
  } catch (e) {
    await db.query('DELETE FROM client WHERE id = $1', [c.id]); // never leave a half-made client behind
    throw e;
  }
  return c.id;
}

export function infoRoutes({ app, db, now = () => new Date() }) {
  const headers = (res) => res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' });
  const attempts = new Map(); // ip -> {n, resetAt}: the page is public, so submissions are rate limited

  // The page itself is the app's single-page UI; it switches to the public form when the path is /intake.
  app.get('/intake', (req, res) => { headers(res); res.sendFile(INDEX); });

  app.post('/intake-api/submit', async (req, res) => {
    headers(res);
    const a = attempts.get(req.ip);
    if (a && a.resetAt > Date.now() && a.n >= 20) return res.status(429).json({ error: 'Too many submissions from this address. Please try again later.' });
    attempts.set(req.ip, { n: a && a.resetAt > Date.now() ? a.n + 1 : 1, resetAt: a?.resetAt > Date.now() ? a.resetAt : Date.now() + 60 * 60e3 });
    const f = sanitize(req.body?.form);
    const missing = requiredItems(f).filter(([, , ok]) => !ok);
    if (missing.length) return res.status(400).json({ error: `Please complete: ${missing.map(([, l]) => l).join('; ')}.`, missing: missing.map(([k]) => k) });
    // One clinician for now (multi-clinician is a later milestone): the new client belongs to the first account.
    const { rows: [clinician] } = await db.query('SELECT * FROM clinician ORDER BY created_at, id LIMIT 1');
    if (!clinician) return res.status(503).json({ error: 'The intake form is not available right now. Please try again later.' });
    const at = now();
    f.signed_at = Object.fromEntries(SIGS.filter((k) => f[k]).map((k) => [k, at.toISOString()]));
    const id = await createClientFromForm(db, clinician, f, at);
    await db.query(`INSERT INTO audit_log (clinician_id, action, entity, entity_id, detail) VALUES ($1, 'create', 'client', $2, $3)`, [clinician.id, id, { via: 'intake_form' }]);
    // The page after Submit carries the consultation booking link so the family can book right away (SPEC 5.1a step 3).
    res.json({ submitted: true, booking_url: clinician.settings_json?.consult_booking_url ?? null });
  });
}
