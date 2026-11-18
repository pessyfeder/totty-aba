// Parents' client information page (SPEC 5.1a). The "reached out" email links here (/info/<token>): an unguessable,
// per-client link with no login. Parents fill in the profile and press Submit, which moves the client to
// "information submitted" and drafts the initial consultation email for Yisroel's approval.
import { ensureDraft } from './consult-email.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clean = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const GENDERS = ['Male', 'Female', 'Other'];

const page = (body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Client information</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:34rem;margin:2rem auto;padding:0 1rem;color:#222}label{display:block;margin:.8rem 0 .2rem;font-weight:600}
input,select,textarea{width:100%;padding:.5rem;font:inherit;box-sizing:border-box}input[type=checkbox]{width:auto}.row{display:flex;gap:.5rem;align-items:flex-start;margin-top:1rem}
.row label{margin:0;font-weight:400}button{margin-top:1.2rem;padding:.7rem 1.4rem;font:inherit;font-weight:600;cursor:pointer}.err{color:#b00020}.ok{color:#146c2e}</style></head><body>${body}</body></html>`;

export function infoRoutes({ app, db, now = () => new Date() }) {
  const find = async (token) => {
    const { rows } = await db.query(
      `SELECT c.id, c.first_name, c.dob::text AS dob, c.gender, c.notes, c.intake_status, c.info_submitted_at, cn.name AS clinician_name
         FROM client c JOIN clinician cn ON cn.id = c.clinician_id WHERE c.info_token = $1 AND c.status = 'active'`, [token]);
    return rows[0];
  };
  const headers = (res) => res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' });
  const notFound = (res) => res.status(404).type('html').send(page('<h1>Link not valid</h1><p>This link is not valid. Please ask Yisroel Feder, LBA, BCBA for a new one.</p>'));

  const form = (c, contact, error) => page(`
<h1>Information for ${esc(c.first_name)}</h1>
<p>Please fill in the details below and press Submit. ${esc(c.clinician_name || 'Your behavior analyst')} will contact you about the next step.</p>
${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}
<form method="post">
<h2>Your child</h2>
<label for="dob">Date of birth</label><input id="dob" name="dob" type="date" value="${esc(c.dob)}">
<label for="gender">Gender</label><select id="gender" name="gender"><option value=""></option>${GENDERS.map((g) => `<option${g === c.gender ? ' selected' : ''}>${g}</option>`).join('')}</select>
<label for="notes">Anything we should know (background, interests, concerns)</label><textarea id="notes" name="notes" rows="4">${esc(c.notes)}</textarea>
<h2>Parent / guardian</h2>
<label for="name">Your name</label><input id="name" name="name" required value="${esc(contact?.name)}">
<label for="relationship">Relationship to child</label><input id="relationship" name="relationship" value="${esc(contact?.relationship)}">
<label for="phone">Mobile phone (for text prompts)</label><input id="phone" name="phone" type="tel" value="${esc(contact?.phone)}">
<label for="email">Email</label><input id="email" name="email" type="email" required value="${esc(contact?.email)}">
<label for="language">Preferred language</label><input id="language" name="language" value="${esc(contact?.language)}">
<div class="row"><input id="consent" name="consent" type="checkbox" value="1"${contact?.consent_given_at ? ' checked' : ''}><label for="consent">I agree to receive text messages about my child's goals.</label></div>
<button type="submit">Submit</button></form>`);

  app.get('/info/:token', async (req, res) => {
    headers(res);
    const c = await find(req.params.token);
    if (!c) return notFound(res);
    if (c.info_submitted_at) return res.type('html').send(page(`<h1>Thank you</h1><p class="ok">The information for ${esc(c.first_name)} was submitted. You will hear from us about the next step.</p>`));
    const { rows: [contact] } = await db.query('SELECT * FROM contact WHERE client_id = $1 ORDER BY id LIMIT 1', [c.id]);
    res.type('html').send(form(c, contact));
  });

  app.post('/info/:token', async (req, res) => {
    headers(res);
    const c = await find(req.params.token);
    if (!c) return notFound(res);
    const b = req.body ?? {};
    const { rows: [contact] } = await db.query('SELECT * FROM contact WHERE client_id = $1 ORDER BY id LIMIT 1', [c.id]);
    const name = clean(b.name, 200), email = clean(b.email, 200);
    if (!name || !/^[^@\s]+@[^@\s]+$/.test(email)) return res.status(400).type('html').send(form(c, { ...contact, name, email }, 'Please enter your name and a valid email address.'));
    const dob = /^\d{4}-\d{2}-\d{2}$/.test(clean(b.dob)) ? clean(b.dob) : null;
    const gender = GENDERS.includes(b.gender) ? b.gender : null;
    // Only empty client fields are filled; what Yisroel already entered stays.
    await db.query(
      `UPDATE client SET dob = COALESCE(dob, $2::date), gender = COALESCE(gender, $3), notes = COALESCE(NULLIF(notes, ''), $4),
              info_submitted_at = $5, updated_at = $5 WHERE id = $1`, [c.id, dob, gender, clean(b.notes, 2000) || null, now()]);
    const fields = { name, relationship: clean(b.relationship, 100) || null, phone: clean(b.phone, 40) || null, email, language: clean(b.language, 50) || null };
    if (contact) {
      await db.query(
        `UPDATE contact SET name = $2, relationship = COALESCE($3, relationship), phone = COALESCE($4, phone), email = $5, language = COALESCE($6, language),
                consent_given_at = CASE WHEN $7 THEN COALESCE(consent_given_at, $8) ELSE consent_given_at END WHERE id = $1`,
        [contact.id, fields.name, fields.relationship, fields.phone, fields.email, fields.language, b.consent === '1', now()]);
    } else {
      await db.query(
        `INSERT INTO contact (client_id, name, relationship, phone, email, language, consent_given_at) VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'en'), $7)`,
        [c.id, fields.name, fields.relationship, fields.phone, fields.email, fields.language, b.consent === '1' ? now() : null]);
    }
    const { rows } = await db.query(
      `UPDATE client SET intake_status = 'paperwork_received' WHERE id = $1 AND intake_status = 'inquiry' RETURNING id`, [c.id]);
    if (rows.length) await ensureDraft(db, c.id);
    res.type('html').send(page(`<h1>Thank you</h1><p class="ok">The information for ${esc(c.first_name)} was submitted. You will hear from us about the next step.</p>`));
  });
}
