// Intake upload and auto-fill (SPEC 5.1a step 3, 5.7b).
// The family's form comes from an external tool, exported as JSON or CSV (one submission). Its answers fill
// the client's EMPTY fields only; where the form disagrees with a value Totty already entered, his value stays
// and the disagreement is reported (field plus both values) for him to resolve.
import crypto from 'node:crypto';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ALLOWED_EXT = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain', csv: 'text/csv', json: 'application/json' };

// ---- Encryption at rest ----
const keyOf = (secret) => crypto.createHash('sha256').update(`totty-aba documents v1:${secret}`).digest();

export function encrypt(secret, id, plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyOf(secret), iv);
  c.setAAD(Buffer.from(id));
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]);
}

export function decrypt(secret, id, blob) {
  const buf = Buffer.from(blob);
  const d = crypto.createDecipheriv('aes-256-gcm', keyOf(secret), buf.subarray(0, 12));
  d.setAAD(Buffer.from(id));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]);
}

/** Basename only, no control characters; keeps the name readable in downloads. */
export function safeFilename(name) {
  const base = String(name ?? '').split(/[\\/]/).pop().replace(/[\u0000-\u001f"<>|:*?]/g, '').trim().slice(0, 150);
  return base || 'upload';
}
export const extOf = (name) => (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase();

// ---- Form parsing ----
/** Minimal RFC 4180 CSV reader (quoted fields, doubled quotes, CRLF, embedded newlines). */
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  const t = text.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (quoted) {
      if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Normalised form-question text -> our field. Covers typical form-builder headers ("Child's first name").
const ALIASES = {
  first_name: ['firstname', 'childfirstname', 'childsfirstname', 'clientfirstname', 'firstnameofchild'],
  last_name: ['lastname', 'surname', 'familyname', 'childlastname', 'childslastname', 'clientlastname', 'lastnameofchild'],
  dob: ['dob', 'dateofbirth', 'birthdate', 'birthday', 'childdob', 'childdateofbirth', 'childsdateofbirth', 'childsbirthdate'],
  gender: ['gender', 'sex', 'childgender', 'childsgender'],
  location_name: ['location', 'city', 'citystate', 'town', 'cityandstate', 'homecity', 'address'],
  notes: ['notes', 'additionalnotes', 'comments', 'additionalinformation', 'anythingelse', 'anythingelseweshouldknow', 'anythingelseweshouldknowabout', 'concerns'],
  'contact.name': ['parentname', 'guardianname', 'parentguardianname', 'parentorguardianname', 'parentguardian', 'contactname', 'parentfullname', 'guardianfullname'],
  'contact.relationship': ['relationship', 'relationshiptochild', 'relationshiptoclient'],
  'contact.phone': ['phone', 'phonenumber', 'parentphone', 'parentphonenumber', 'guardianphone', 'mobile', 'cell', 'cellphone', 'mobilenumber'],
  'contact.email': ['email', 'emailaddress', 'parentemail', 'guardianemail'],
  'contact.language': ['language', 'preferredlanguage', 'primarylanguage', 'languagespokenathome'],
  'contact.preferred_channel': ['preferredchannel', 'preferredcontactmethod', 'contactmethod', 'preferredcontact', 'howwouldyouprefertobecontacted'],
};
const ALIAS_LOOKUP = Object.fromEntries(Object.entries(ALIASES).flatMap(([f, names]) => names.map((n) => [n, f])));

const LANGUAGES = { english: 'en', yiddish: 'yi', hebrew: 'he', spanish: 'es', russian: 'ru', french: 'fr', arabic: 'ar' };

/** Form value -> stored value, or {error} when it cannot be used. Never guesses. */
function clean(field, raw) {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  switch (field) {
    case 'dob': {
      let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
      let [y, mo, d] = m ? [m[1], m[2], m[3]] : [];
      if (!m && (m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v))) [mo, d, y] = [m[1], m[2], m[3]]; // US M/D/YYYY
      if (!y) return { error: `"${v}" is not a date (use YYYY-MM-DD or M/D/YYYY)` };
      const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dt = new Date(`${iso}T00:00:00Z`);
      if (Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== iso || dt > new Date()) return { error: `"${v}" is not a valid date of birth` };
      return iso;
    }
    case 'contact.phone': {
      const digits = v.replace(/[^\d+]/g, '');
      const e164 = digits.startsWith('+') ? digits : digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits[0] === '1' ? `+${digits}` : null;
      return e164 && /^\+[1-9][0-9]{6,14}$/.test(e164) ? e164 : { error: `"${v}" is not a usable phone number (use +country code or a 10-digit US number)` };
    }
    case 'contact.email':
      return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? v : { error: `"${v}" is not a valid email` };
    case 'contact.language': {
      const l = v.toLowerCase();
      return LANGUAGES[l] ?? (/^[a-z]{2}$/.test(l) ? l : { error: `language "${v}" is not recognised` });
    }
    case 'contact.preferred_channel': {
      const l = v.toLowerCase();
      if (/\b(text|sms)\b/.test(l)) return 'sms';
      if (/\b(call|phone|voice)\b/.test(l)) return 'call';
      return { error: `preferred channel "${v}" must be text or call` };
    }
    case 'gender': return v.slice(0, 50);
    default: return v;
  }
}

/**
 * Reads a form export (.json or .csv) into {client: {...}, contacts: [{...}], warnings: [...]}.
 * Unrecognised questions are ignored. Throws a user-facing Error when the file is not one submission.
 */
export function parseForm(filename, buffer) {
  const text = buffer.toString('utf8');
  let flat;
  let extraContacts = [];
  if (extOf(filename) === 'json') {
    let j;
    try { j = JSON.parse(text); } catch { throw new Error('The form file is not valid JSON'); }
    if (Array.isArray(j)) {
      if (j.length !== 1) throw new Error(`The form file holds ${j.length} submissions; upload one family's submission`);
      j = j[0];
    }
    if (!j || typeof j !== 'object') throw new Error('The form file must be a JSON object');
    flat = Object.fromEntries(Object.entries(j.fields && typeof j.fields === 'object' ? j.fields : j).filter(([k, v]) => k !== 'contacts' && (v == null || typeof v !== 'object')));
    if (Array.isArray(j.contacts)) extraContacts = j.contacts.filter((c) => c && typeof c === 'object');
  } else {
    const rows = parseCsv(text);
    if (rows.length < 2) throw new Error('The form CSV needs a header row and one submission');
    if (rows.length > 2) throw new Error(`The form CSV holds ${rows.length - 1} submissions; upload one family's submission`);
    flat = Object.fromEntries(rows[0].map((hdr, i) => [hdr, rows[1][i] ?? '']));
  }

  const out = { client: {}, contacts: [], warnings: [] };
  const flatContact = {};
  const take = (target, field, raw, label) => {
    const key = field.replace(/^contact\./, '');
    const v = clean(field, raw);
    if (v == null) return;
    if (typeof v === 'object') { out.warnings.push(`${label}: ${v.error}`); return; }
    if (!(key in target)) target[key] = v; // first matching question wins
  };
  for (const [hdr, raw] of Object.entries(flat)) {
    const field = ALIAS_LOOKUP[norm(hdr)];
    if (!field) continue;
    take(field.startsWith('contact.') ? flatContact : out.client, field, raw, hdr);
  }
  const named = (c) => ({ ...c });
  if (Object.keys(flatContact).length) out.contacts.push(named(flatContact));
  for (const c of extraContacts) {
    const one = {};
    for (const [k, raw] of Object.entries(c)) {
      const field = ALIAS_LOOKUP[norm(k)];
      if (field?.startsWith('contact.')) take(one, field, raw, `contacts.${k}`);
    }
    if (Object.keys(one).length) out.contacts.push(one);
  }
  for (const c of out.contacts) {
    if (!c.name && (c.phone || c.email)) {
      out.warnings.push('A parent/guardian has contact details but no name, so they were not added');
      c.skip = true;
    }
  }
  out.contacts = out.contacts.filter((c) => !c.skip);
  return out;
}

// ---- Auto-fill ----
const CLIENT_LABEL = { first_name: 'first name', last_name: 'last name', dob: 'date of birth', gender: 'gender', location_name: 'location', notes: 'notes' };
const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/**
 * Compares a parsed form with the client's current data. Pure: returns what would be filled and what conflicts.
 * `client.dob` must be YYYY-MM-DD text. Contact defaults ('sms', 'en') count as empty because the schema fills
 * them in before anyone has chosen.
 */
export function planFill(client, contacts, form) {
  const fill = { client: {}, newContacts: [], contactFills: [] };
  const conflicts = [];
  for (const [k, v] of Object.entries(form.client)) {
    const cur = client[k];
    if (cur == null || String(cur).trim() === '') fill.client[k] = v;
    else if (!same(cur, v)) conflicts.push({ field: CLIENT_LABEL[k], entered: String(cur), form: String(v) });
  }
  for (const fc of form.contacts) {
    const match = contacts.find((c) => same(c.name, fc.name) || (fc.phone && c.phone === fc.phone));
    if (!match) { fill.newContacts.push(fc); continue; }
    const set = {};
    for (const k of ['relationship', 'phone', 'email', 'language', 'preferred_channel']) {
      if (fc[k] == null) continue;
      const cur = match[k];
      const empty = cur == null || String(cur).trim() === '' || (k === 'language' && cur === 'en') || (k === 'preferred_channel' && cur === 'sms');
      if (empty) { if (cur !== fc[k]) set[k] = fc[k]; } else if (!same(cur, fc[k])) conflicts.push({ field: `${match.name}: ${k.replace('_', ' ')}`, entered: String(cur), form: String(fc[k]) });
    }
    if (Object.keys(set).length) fill.contactFills.push({ id: match.id, name: match.name, set });
  }
  return { fill, conflicts };
}

/** Applies planFill's result. Returns the list of fields that were filled, for the audit trail and the UI. */
export async function applyFill(db, clientId, fill) {
  const filled = [];
  const cols = Object.keys(fill.client);
  if (cols.length) {
    await db.query(`UPDATE client SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`, [clientId, ...cols.map((k) => fill.client[k])]);
    filled.push(...cols.map((k) => CLIENT_LABEL[k]));
  }
  for (const c of fill.contactFills) {
    const ks = Object.keys(c.set);
    await db.query(`UPDATE contact SET ${ks.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [c.id, ...ks.map((k) => c.set[k])]);
    filled.push(...ks.map((k) => `${c.name}: ${k.replace('_', ' ')}`));
  }
  for (const c of fill.newContacts) {
    // No consent is recorded from a form: written consent to text/call is captured separately (SPEC 8).
    const ks = Object.keys(c);
    await db.query(`INSERT INTO contact (client_id, ${ks.join(', ')}) VALUES ($1, ${ks.map((_, i) => `$${i + 2}`).join(', ')})`, [clientId, ...ks.map((k) => c[k])]);
    filled.push(`added contact ${c.name}`);
  }
  return filled;
}
