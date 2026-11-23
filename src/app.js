// HTTP API for Totty's web app. Every /api route except /api/status is locked during Shabbos / Yom Tov
// (SPEC 5.3): the server refuses, not just the buttons. Telnyx webhooks are never locked.
import express from 'express';
import { fileURLToPath } from 'node:url';
import { COOKIE, createSession, readSession, parseCookies, verifyPassword } from './auth.js';
import { locationFrom, windowAt } from './shabbos.js';
import { loadDashboard } from './dashboard.js';
import { handleInbound } from './inbound.js';
import { verifyTelnyxSignature } from './messaging.js';
import { reportRoutes } from './report-routes.js';
import { ensureDraft } from './consult-email.js';
import * as consultEmail from './consult-email.js';
import * as inquiryEmail from './inquiry-email.js';
import * as consultText from './consult-text.js';
import { textStatus } from './text-status.js';
import { buildCheckinBody } from './scheduler.js';
import { appointmentKind } from './calendar.js';
import { infoRoutes } from './info-routes.js';
import { clearIfEmailChanged, flagBounce, parseBounceEvents, secretMatches } from './bounce.js';

// Check-ins this client already had before an appointment: tells the first (baseline) check-in from later weekly ones.
const EARLIER_CHECKINS = `(SELECT count(*) FROM appointment p WHERE p.client_id = a.client_id AND p.type = 'check-in'
  AND p.status = 'scheduled' AND p.starts_at < a.starts_at) AS earlier_checkins`;
const withKind = ({ earlier_checkins, ...a }) => ({ ...a, kind: appointmentKind(a.type, earlier_checkins) });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLIENT_FIELDS = ['first_name', 'last_name', 'gender', 'dob', 'admission_date', 'notes', 'location_name', 'street_address', 'city', 'state', 'zip', 'latitude', 'longitude', 'timezone', 'in_israel', 'candle_lighting_minutes'];
const CONTACT_FIELDS = ['name', 'relationship', 'phone', 'email', 'preferred_channel', 'logging_method', 'language', 'status', 'consent_given_at', 'consent_note'];
const GOAL_FIELDS = ['contact_id', 'title', 'description', 'question_text', 'response_type', 'channel', 'schedule_json', 'date_added', 'start_date', 'end_date', 'status', 'target_json'];
const REINFORCEMENT_FIELDS = ['name', 'note'];
// Links to the website's appointment scheduling portal (SPEC 5.1a, 5.7b): the app stores them and puts them in messages; the website handles booking and payment, the app never creates bookings.
const LINK_SETTINGS = ['consult_booking_url', 'checkin_booking_url', 'client_info_url'];

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
const bad = (msg) => new HttpError(400, msg);
const MANUAL_STATUSES = ['scheduled', 'missed', 'completed'];
const apptTime = (v) => { const d = new Date(v); if (Number.isNaN(d.getTime())) throw bad('Date and time is not valid'); return d; };

const validTimezone = (tz) => {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
};

/** Whitelisted columns only, so request keys never reach SQL as identifiers. */
function pick(body, allowed) {
  return Object.fromEntries(Object.entries(body ?? {}).filter(([k]) => allowed.includes(k)));
}

function checkClient(f, { partial }) {
  if (!partial) for (const k of ['first_name', 'last_name', 'admission_date', 'latitude', 'longitude', 'timezone']) {
    if (f[k] == null || f[k] === '') throw bad(`${k} is required`);
  }
  if (f.state != null && !['NY', 'NJ'].includes(f.state)) throw bad('state must be NY or NJ');
  if ('timezone' in f && !validTimezone(f.timezone)) throw bad('timezone is not a valid IANA zone');
  if ('latitude' in f && !(Math.abs(f.latitude) <= 90)) throw bad('latitude out of range');
  if ('longitude' in f && !(Math.abs(f.longitude) <= 180)) throw bad('longitude out of range');
}

function checkGoal(f, { partial }) {
  if (!partial) for (const k of ['contact_id', 'title', 'response_type', 'channel', 'schedule_json', 'start_date']) {
    if (f[k] == null || f[k] === '') throw bad(`${k} is required`);
  }
  if ('schedule_json' in f) {
    const s = f.schedule_json;
    const ok = Array.isArray(s?.days) && s.days.length && s.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) && /^([01]\d|2[0-3]):[0-5]\d$/.test(s?.time);
    if (!ok) throw bad('schedule_json must be {days: [0-6...], time: "HH:MM"}');
  }
}

export function createApp({ db, messenger, mailer, config, now = () => new Date() }) {
  const app = express();
  app.disable('x-powered-by');
  // Keep the raw body: Telnyx signs the exact bytes it sent.
  app.use(express.json({ limit: '100kb', verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); } }));
  app.use(express.urlencoded({ extended: false }));

  inquiryEmail.setPublicUrl(config.publicUrl);
  app.param('id', (req, res, next, id) => (UUID.test(id) ? next() : next(new HttpError(404, 'Not found'))));

  // ---- Telnyx inbound webhook: always accepted, never locked ----
  app.post('/webhooks/telnyx/sms', async (req, res) => {
    if (config.telnyx?.publicKey) {
      const ok = verifyTelnyxSignature({
        publicKey: config.telnyx.publicKey,
        signature: req.get('telnyx-signature-ed25519'),
        timestamp: req.get('telnyx-timestamp'),
        rawBody: req.rawBody,
        now: now(),
      });
      if (!ok) return res.status(403).end();
    } else if (config.production) {
      return res.status(503).end(); // refuse unsigned webhooks in production
    }
    const event = req.body?.data;
    const p = event?.payload;
    // Only inbound texts matter; delivery-status events are acknowledged and ignored.
    if (event?.event_type === 'message.received' && p?.direction !== 'outbound' && p?.from?.phone_number) {
      await handleInbound({ db, messenger, from: p.from.phone_number, body: p.text ?? '', providerId: p.id ?? null, now: now() });
    }
    res.status(200).end();
  });

  // ---- Email provider bounce webhook (SPEC 5.4b B): flags the contact; never locked. Shared secret in ?token= or x-webhook-secret. ----
  app.post('/webhooks/email/bounce', async (req, res) => {
    const secret = config.emailWebhookSecret;
    if (!secret) return res.status(config.production ? 503 : 404).end();
    if (!secretMatches(secret, req.query.token ?? req.get('x-webhook-secret'))) return res.status(403).end();
    let flagged = 0;
    for (const e of parseBounceEvents(req.body)) flagged += await flagBounce({ db, email: e.email, reason: e.reason, at: now(), hard: e.hard });
    res.status(200).json({ flagged });
  });

  // ---- The public intake form (SPEC 5.1a): one general page, no login ----
  infoRoutes({ app, db, now });

  // ---- Session + Shabbos lock ----
  const getClinician = async (id) => {
    const { rows } = id
      ? await db.query('SELECT * FROM clinician WHERE id = $1', [id])
      : await db.query('SELECT * FROM clinician ORDER BY created_at LIMIT 1'); // v1 is single-clinician
    return rows[0] ?? null;
  };
  const lockOf = (clinician) => clinician && windowAt(now(), locationFrom(clinician, clinician.settings_json));

  app.use('/api', async (req, res, next) => {
    req.clinicianId = readSession(config.sessionSecret, parseCookies(req.headers.cookie)[COOKIE], now());
    if (req.path === '/status') return next();
    // req.clinician is set only for a valid session. The lock uses the session's clinician, or the
    // single v1 clinician before login, and must never imply that the caller is logged in.
    const me = req.clinicianId ? await getClinician(req.clinicianId) : null;
    const w = lockOf(me ?? (await getClinician(null)));
    if (w) return res.status(423).json({ error: 'shabbos', kind: w.kind, reopensAt: w.end });
    req.clinician = me;
    next();
  });

  app.get('/api/status', async (req, res) => {
    const me = req.clinicianId ? await getClinician(req.clinicianId) : null;
    const w = lockOf(me ?? (await getClinician(null)));
    res.json({ locked: Boolean(w), kind: w?.kind ?? null, reopensAt: w?.end ?? null, authenticated: Boolean(req.clinicianId) });
  });

  const attempts = new Map(); // ip -> {n, resetAt}
  app.post('/api/login', async (req, res) => {
    const ip = req.ip;
    const a = attempts.get(ip);
    if (a && a.resetAt > Date.now() && a.n >= 10) throw new HttpError(429, 'Too many attempts, try again later');
    const { rows } = await db.query('SELECT * FROM clinician WHERE lower(email) = lower($1)', [String(req.body?.email ?? '')]);
    const ok = rows[0] && (await verifyPassword(String(req.body?.password ?? ''), rows[0].password_hash));
    if (!ok) {
      attempts.set(ip, { n: a && a.resetAt > Date.now() ? a.n + 1 : 1, resetAt: a?.resetAt > Date.now() ? a.resetAt : Date.now() + 15 * 60e3 });
      throw new HttpError(401, 'Invalid email or password');
    }
    attempts.delete(ip);
    const secure = config.production ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${COOKIE}=${createSession(config.sessionSecret, rows[0].id, now())}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}`);
    res.json({ ok: true });
  });

  app.post('/api/logout', (req, res) => {
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    res.json({ ok: true });
  });

  // Everything below needs a login. State-changing requests also need the custom header (CSRF defence in depth).
  app.use('/api', (req, res, next) => {
    if (!req.clinician) return next(new HttpError(401, 'Login required'));
    if (req.method !== 'GET' && req.get('X-Requested-With') !== 'totty') return next(new HttpError(403, 'Missing X-Requested-With'));
    next();
  });

  const audit = (req, action, entity, entityId, detail = null) =>
    db.query('INSERT INTO audit_log (clinician_id, action, entity, entity_id, detail) VALUES ($1, $2, $3, $4, $5)', [req.clinician.id, action, entity, entityId, detail]);

  const ownedClient = async (req, clientId) => {
    const { rows } = await db.query('SELECT id FROM client WHERE id = $1 AND clinician_id = $2', [clientId, req.clinician.id]);
    if (!rows.length) throw new HttpError(404, 'Not found');
  };
  // jsonb columns take objects/arrays; Dates and scalars pass through unchanged.
  const bind = (v) => (v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v);
  const insertRow = async (table, data) => {
    const keys = Object.keys(data);
    const { rows } = await db.query(
      `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
      keys.map((k) => bind(data[k])),
    );
    return rows[0];
  };
  /** UPDATE <table> SET ... WHERE id AND <scope>; scope is trusted SQL using $1 = id, $2 = clinician id. */
  const updateRow = async (req, table, id, data, scope) => {
    const keys = Object.keys(data);
    if (!keys.length) throw bad('Nothing to update');
    const { rows } = await db.query(
      `UPDATE ${table} SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')} WHERE id = $1 AND ${scope} RETURNING *`,
      [id, req.clinician.id, ...keys.map((k) => bind(data[k]))],
    );
    if (!rows.length) throw new HttpError(404, 'Not found');
    return rows[0];
  };
  const viaClient = 'client_id IN (SELECT id FROM client WHERE clinician_id = $2)';

  app.get('/api/dashboard', async (req, res) => res.json(await loadDashboard(db, req.clinician, now())));

  // ---- Settings: booking and intake links (SPEC 5.1a). Empty string clears a link. ----
  const checkinPreview = (settings) =>
    buildCheckinBody({ first_name: "[child's first name]" }, settings?.checkin_booking_url || '[booking link]');
  app.get('/api/settings', async (req, res) => {
    const { rows: waiting } = await db.query(
      `SELECT c.id, c.first_name, c.last_name FROM client c JOIN inquiry_email e ON e.client_id = c.id
        WHERE c.clinician_id = $1 AND c.intake_status = 'inquiry' AND c.status = 'active' AND e.status = 'pending_approval'
        ORDER BY lower(c.last_name), lower(c.first_name)`, [req.clinician.id]);
    res.json({
      first_reply_template: inquiryEmail.buildInquiryEmail({ client: { first_name: "[child's first name]" }, contact: { name: '[parent name]' },
        clinician: { name: req.clinician.name }, link: req.clinician.settings_json?.client_info_url || '[client information page link]', body: req.clinician.settings_json?.first_reply_body }),
      first_reply_body: req.clinician.settings_json?.first_reply_body || inquiryEmail.DEFAULT_BODY,
      first_reply_clients: waiting,
      checkin_text_preview: checkinPreview(req.clinician.settings_json),
      ...Object.fromEntries(LINK_SETTINGS.map((k) => [k, req.clinician.settings_json?.[k] ?? ''])),
    });
  });
  app.put('/api/settings', async (req, res) => {
    const next = { ...req.clinician.settings_json };
    for (const [k, raw] of Object.entries(pick(req.body, LINK_SETTINGS))) {
      const v = typeof raw === 'string' ? raw.trim() : raw;
      if (v === '' || v == null) { delete next[k]; continue; }
      let u;
      try { u = new URL(v); } catch { throw bad(`${k} must be a full web address (https://...)`); }
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw bad(`${k} must start with https://`);
      next[k] = u.href;
    }
    if (typeof req.body?.first_reply_body === 'string') {
      const b = req.body.first_reply_body.replaceAll('\r\n', '\n').trim();
      if (!b || b === inquiryEmail.DEFAULT_BODY) delete next.first_reply_body;
      else if (!b.includes('{link}')) throw bad('The email must keep {link} where the client information page link goes');
      else if (b.length > 5000) throw bad('The email is too long');
      else next.first_reply_body = b;
    }
    await db.query('UPDATE clinician SET settings_json = $2 WHERE id = $1', [req.clinician.id, JSON.stringify(next)]);
    await audit(req, 'update', 'settings', req.clinician.id, { fields: Object.keys(req.body ?? {}).filter((k) => LINK_SETTINGS.includes(k) || k === 'first_reply_body') });
    res.json(Object.fromEntries(LINK_SETTINGS.map((k) => [k, next[k] ?? ''])));
  });

  // ---- Appointments (SPEC 5.7b) ----
  app.get('/api/appointments', async (req, res) => {
    // Optional ?from=&to= (ISO) lets the Schedule calendar page through months, past ones included.
    const parse = (v) => { const d = typeof v === 'string' ? new Date(v) : null; return d && !Number.isNaN(d.getTime()) ? d : null; };
    const from = parse(req.query.from), to = parse(req.query.to);
    const { rows } = await db.query(
      `SELECT a.id, a.client_id, a.type, a.starts_at, a.ends_at, a.status, a.title, c.first_name, c.last_name, ${EARLIER_CHECKINS}
         FROM appointment a LEFT JOIN client c ON c.id = a.client_id
        WHERE a.clinician_id = $1 AND a.status = 'scheduled' AND a.starts_at >= $2 AND a.starts_at < $3
        ORDER BY a.starts_at`, [req.clinician.id, from ?? now(), to ?? new Date('9999-12-31T00:00:00Z')]);
    res.json(rows.map(withKind));
  });
  // One appointment's page: which kind it is, its client's goals and reinforcements, and the clinician's notes.
  app.get('/api/appointments/:id', async (req, res) => {
    const { rows } = await db.query(
      `SELECT a.id, a.client_id, a.type, a.starts_at, a.ends_at, a.status, a.title, a.notes, c.first_name, c.last_name, ${EARLIER_CHECKINS}
         FROM appointment a LEFT JOIN client c ON c.id = a.client_id
        WHERE a.id = $1 AND a.clinician_id = $2`, [req.params.id, req.clinician.id]);
    if (!rows.length) throw new HttpError(404, 'Not found');
    const appt = withKind(rows[0]);
    let goals = [], reinforcements = [];
    if (appt.client_id) {
      [goals, reinforcements] = await Promise.all(['goal', 'reinforcement'].map((t) =>
        db.query(`SELECT * FROM ${t} WHERE client_id = $1 ORDER BY 1`, [appt.client_id]).then((r) => r.rows)));
    }
    await audit(req, 'view', 'appointment', appt.id);
    res.json({ ...appt, goals, reinforcements });
  });
  // Update an appointment: notes, status (scheduled / missed / completed) and/or time.
  app.patch('/api/appointments/:id', async (req, res) => {
    const { rows: cur } = await db.query('SELECT * FROM appointment WHERE id = $1 AND clinician_id = $2', [req.params.id, req.clinician.id]);
    if (!cur.length) throw new HttpError(404, 'Not found');
    const b = req.body ?? {};
    const next = { notes: cur[0].notes, status: cur[0].status, starts_at: cur[0].starts_at };
    if ('notes' in b) {
      if (typeof b.notes !== 'string' || b.notes.length > 20000) throw bad('notes must be text (up to 20,000 characters)');
      next.notes = b.notes.trim() || null;
    }
    if ('status' in b) {
      if (!MANUAL_STATUSES.includes(b.status)) throw bad(`status must be one of: ${MANUAL_STATUSES.join(', ')}`);
      next.status = b.status;
    }
    if ('starts_at' in b) next.starts_at = b.starts_at ? apptTime(b.starts_at) : null;
    if (!next.starts_at) throw bad('A date and time is needed');
    const { rows } = await db.query(
      `UPDATE appointment SET notes = $3, status = $4, starts_at = $5, ends_at = CASE WHEN $5::timestamptz IS DISTINCT FROM starts_at THEN NULL ELSE ends_at END, updated_at = $6
        WHERE id = $1 AND clinician_id = $2 RETURNING id, notes, status, starts_at`,
      [req.params.id, req.clinician.id, next.notes, next.status, next.starts_at, now()]);
    await audit(req, 'update', 'appointment', rows[0].id, { fields: Object.keys(b).filter((k) => ['notes', 'status', 'starts_at'].includes(k)) });
    res.json(rows[0]);
  });
  // Add an appointment (with a date and time) to a client's list. The calendar sync never touches these.
  app.post('/api/clients/:id/appointments', async (req, res) => {
    const { rows: own } = await db.query('SELECT id FROM client WHERE id = $1 AND clinician_id = $2', [req.params.id, req.clinician.id]);
    if (!own.length) throw new HttpError(404, 'Not found');
    const b = req.body ?? {};
    const type = ['consultation', 'check-in'].includes(b.type) ? b.type : 'check-in';
    if (!b.starts_at) throw bad('A date and time is needed');
    const startsAt = apptTime(b.starts_at);
    const status = 'scheduled';
    const { rows } = await db.query(
      `INSERT INTO appointment (clinician_id, client_id, external_id, type, starts_at, status, source)
       VALUES ($1, $2, 'manual:' || gen_random_uuid(), $3, $4, $5, 'manual') RETURNING id, type, starts_at, ends_at, status, title, notes`,
      [req.clinician.id, req.params.id, type, startsAt, status]);
    await audit(req, 'create', 'appointment', rows[0].id);
    res.status(201).json(rows[0]);
  });

  // ---- Clients ----
  app.get('/api/clients', async (req, res) => {
    const q = req.query.q ? `%${String(req.query.q).toLowerCase()}%` : '%';
    const { rows } = await db.query(
      `SELECT * FROM client WHERE clinician_id = $1 AND status = $3
         AND (lower(first_name || ' ' || last_name) LIKE $2) ORDER BY lower(last_name), lower(first_name)`,
      [req.clinician.id, q, req.query.status === 'archived' ? 'archived' : 'active'],
    );
    res.json(rows);
  });

  app.get('/api/clients/:id', async (req, res) => {
    const { rows } = await db.query('SELECT * FROM client WHERE id = $1 AND clinician_id = $2', [req.params.id, req.clinician.id]);
    if (!rows.length) throw new HttpError(404, 'Not found');
    const { rows: appointments } = await db.query(
      `SELECT id, type, starts_at, ends_at, status, title, notes FROM appointment WHERE client_id = $1 ORDER BY starts_at DESC NULLS FIRST`, [req.params.id]);
    const [contacts, goals, reinforcements] = await Promise.all(
      ['contact', 'goal', 'reinforcement'].map((t) => db.query(`SELECT * FROM ${t} WHERE client_id = $1 ORDER BY 1`, [req.params.id]).then((r) => r.rows)),
    );
    const { rows: changes } = await db.query(
      `SELECT goal_id, from_status, to_status, change_made_datetime FROM goal_status_change
        WHERE goal_id = ANY($1::uuid[]) ORDER BY change_made_datetime`, [goals.map((g) => g.id)]);
    for (const g of goals) g.status_changes = changes.filter((c) => c.goal_id === g.id);
    await audit(req, 'view', 'client', req.params.id);
    res.json({ ...rows[0], contacts, goals, reinforcements, appointments });
  });

  app.patch('/api/clients/:id', async (req, res) => {
    const f = pick(req.body, CLIENT_FIELDS);
    checkClient(f, { partial: true });
    if (!Object.keys(f).length) throw bad('Nothing to update');
    const row = await updateRow(req, 'client', req.params.id, { ...f, updated_at: new Date() }, 'clinician_id = $2');
    await audit(req, 'update', 'client', row.id, { fields: Object.keys(f) });
    res.json(row);
  });

  app.post('/api/clients/:id/archive', async (req, res) => {
    const row = await updateRow(req, 'client', req.params.id, { status: req.body?.restore ? 'active' : 'archived', updated_at: new Date() }, 'clinician_id = $2');
    await audit(req, 'archive', 'client', row.id);
    res.json(row);
  });

  // Client status (SPEC 5.1a): reached out -> information submitted -> baseline -> active. Yisroel can move a client
  // between the first three by hand; `active` is reached after the first check-in appointment (or by hand from baseline).
  const setIntakeStatus = async (req, next, from = null) => {
    const { rows } = await db.query(
      `UPDATE client SET intake_status = $3, updated_at = now(),
              baseline_started_at = CASE WHEN $3 = 'baseline' THEN COALESCE(baseline_started_at, now()) ELSE baseline_started_at END,
              activated_at = CASE WHEN $3 = 'active' THEN COALESCE(activated_at, now()) ELSE activated_at END
        WHERE id = $1 AND clinician_id = $2 AND ($4::text IS NULL OR intake_status = $4) RETURNING *`,
      [req.params.id, req.clinician.id, next, from],
    );
    if (!rows.length) {
      await ownedClient(req, req.params.id); // 404 if not theirs
      throw bad(from ? `Client must be at "${from}" first` : 'Client not found');
    }
    if (next === 'paperwork_received') { await ensureDraft(db, rows[0].id); await consultText.ensureDraft(db, rows[0].id); }
    if (next === 'inquiry') await inquiryEmail.ensureDraft(db, rows[0].id);
    await audit(req, 'update', 'client', rows[0].id, { fields: ['intake_status'] });
    return rows[0];
  };
  // Permanent delete: removes the client and, by cascade, their contacts, goals, prompts, responses and documents.
  app.delete('/api/clients/:id', async (req, res) => {
    const { rows } = await db.query(`DELETE FROM client WHERE id = $1 AND clinician_id = $2 RETURNING id`, [req.params.id, req.clinician.id]);
    if (!rows.length) throw new HttpError(404, 'Client not found');
    await audit(req, 'delete', 'client', rows[0].id);
    res.status(204).end();
  });

  app.post('/api/clients/:id/intake-status', async (req, res) => {
    const next = req.body?.intake_status;
    if (!['inquiry', 'paperwork_received', 'baseline', 'active'].includes(next)) throw bad('Invalid intake status');
    res.json(await setIntakeStatus(req, next));
  });

  // ---- Initial consultation email (SPEC 5.7b): drafted at paperwork_received, sent only after Totty approves ----
  app.get('/api/clients/:id/consult-email', async (req, res) => {
    await ownedClient(req, req.params.id);
    res.json(await consultEmail.preview(db, req.params.id));
  });
  app.post('/api/clients/:id/consult-email/approve', async (req, res) => {
    await ownedClient(req, req.params.id);
    try { await consultEmail.approve(db, req.params.id); } catch (e) { throw bad(e.message); }
    await audit(req, 'approve', 'consult_email', req.params.id);
    if (mailer) await consultEmail.sendApproved({ db, mailer, now, clientId: req.params.id });
    res.json(await consultEmail.preview(db, req.params.id));
  });
  app.post('/api/clients/:id/consult-email/cancel', async (req, res) => {
    await ownedClient(req, req.params.id);
    if (!(await consultEmail.cancel(db, req.params.id))) throw bad('There is no unsent consultation email to cancel');
    await audit(req, 'cancel', 'consult_email', req.params.id);
    res.json(await consultEmail.preview(db, req.params.id));
  });

  // ---- Initial consultation text: drafted with the email at "information submitted", sent only after Totty approves ----
  app.get('/api/clients/:id/consult-text', async (req, res) => {
    await ownedClient(req, req.params.id);
    res.json(await consultText.preview(db, req.params.id, now));
  });
  app.post('/api/clients/:id/consult-text/approve', async (req, res) => {
    await ownedClient(req, req.params.id);
    try { await consultText.approve(db, req.params.id); } catch (e) { throw bad(e.message); }
    await audit(req, 'approve', 'consult_text', req.params.id);
    if (messenger) await consultText.sendApproved({ db, messenger, now, clientId: req.params.id });
    res.json(await consultText.preview(db, req.params.id, now));
  });
  app.post('/api/clients/:id/consult-text/cancel', async (req, res) => {
    await ownedClient(req, req.params.id);
    if (!(await consultText.cancel(db, req.params.id))) throw bad('There is no unsent consultation text to cancel');
    await audit(req, 'cancel', 'consult_text', req.params.id);
    res.json(await consultText.preview(db, req.params.id, now));
  });
  // Where every automatic text for this client stands, and why any cannot go out.
  app.get('/api/clients/:id/text-status', async (req, res) => {
    await ownedClient(req, req.params.id);
    res.json(await textStatus(db, req.params.id, now()));
  });

  // ---- First reply to a new inquiry (SPEC 5.1a): drafted at "reached out", sent only after Totty approves ----
  app.get('/api/clients/:id/inquiry-email', async (req, res) => {
    await ownedClient(req, req.params.id);
    res.json(await inquiryEmail.preview(db, req.params.id));
  });
  app.post('/api/clients/:id/inquiry-email/approve', async (req, res) => {
    await ownedClient(req, req.params.id);
    try { await inquiryEmail.approve(db, req.params.id); } catch (e) { throw bad(e.message); }
    await audit(req, 'approve', 'inquiry_email', req.params.id);
    if (mailer) await inquiryEmail.sendApproved({ db, mailer, now, clientId: req.params.id });
    res.json(await inquiryEmail.preview(db, req.params.id));
  });
  app.post('/api/clients/:id/inquiry-email/cancel', async (req, res) => {
    await ownedClient(req, req.params.id);
    if (!(await inquiryEmail.cancel(db, req.params.id))) throw bad('There is no unsent first-reply email to cancel');
    await audit(req, 'cancel', 'inquiry_email', req.params.id);
    res.json(await inquiryEmail.preview(db, req.params.id));
  });

  // Start baseline (SPEC 5.1a): at the initial consultation Yisroel sets goals and the plan, then starts baseline.
  // From then on prompts go to the family (subject to Shabbos/quiet-hours rules and consent).
  app.post('/api/clients/:id/go', async (req, res) => {
    res.json(await setIntakeStatus(req, 'baseline', 'paperwork_received'));
  });

  // ---- Reinforcements (record only, SPEC 5.6a) ----
  app.post('/api/clients/:id/reinforcements', async (req, res) => {
    await ownedClient(req, req.params.id);
    const f = pick(req.body, REINFORCEMENT_FIELDS);
    if (!f.name) throw bad('name is required');
    res.status(201).json(await insertRow('reinforcement', { ...f, client_id: req.params.id }));
  });
  app.patch('/api/reinforcements/:id', async (req, res) =>
    res.json(await updateRow(req, 'reinforcement', req.params.id, pick(req.body, REINFORCEMENT_FIELDS), viaClient)));
  app.delete('/api/reinforcements/:id', async (req, res) => {
    const { rows } = await db.query(`DELETE FROM reinforcement WHERE id = $1 AND ${viaClient} RETURNING id`, [req.params.id, req.clinician.id]);
    if (!rows.length) throw new HttpError(404, 'Not found');
    res.status(204).end();
  });

  // ---- Contacts ----
  app.post('/api/clients/:id/contacts', async (req, res) => {
    await ownedClient(req, req.params.id);
    const f = pick(req.body, CONTACT_FIELDS);
    if (!f.name) throw bad('name is required');
    const row = await insertRow('contact', { ...f, client_id: req.params.id });
    await audit(req, 'create', 'contact', row.id);
    res.status(201).json(row);
  });
  app.patch('/api/contacts/:id', async (req, res) => {
    const f = pick(req.body, CONTACT_FIELDS);
    if ('name' in f && !String(f.name ?? '').trim()) throw bad('name is required');
    const before = 'email' in f ? (await db.query('SELECT email FROM contact WHERE id = $1', [req.params.id])).rows[0] : null;
    const row = await updateRow(req, 'contact', req.params.id, f, viaClient);
    if (before && await clearIfEmailChanged({ db, contactId: row.id, previousEmail: before.email, nextEmail: row.email })) {
      row.email_bounced_at = null;
      row.email_bounce_reason = null;
    }
    await audit(req, 'update', 'contact', row.id, { fields: Object.keys(f) });
    res.json(row);
  });

  // ---- Goals ----
  app.post('/api/clients/:id/goals', async (req, res) => {
    await ownedClient(req, req.params.id);
    const f = pick(req.body, GOAL_FIELDS);
    checkGoal(f, { partial: false });
    const { rows } = await db.query('SELECT 1 FROM contact WHERE id = $1 AND client_id = $2', [f.contact_id, req.params.id]);
    if (!rows.length) throw bad('contact_id must belong to this client');
    const row = await insertRow('goal', { ...f, client_id: req.params.id });
    await audit(req, 'create', 'goal', row.id);
    res.status(201).json(row);
  });
  // Goals are not editable once added (SPEC 5.2): the only change allowed is its status, so a goal's
  // question, schedule and history cannot silently change. To change a goal, archive it and add a new one.
  app.patch('/api/goals/:id', async (req, res) => {
    const status = req.body?.status;
    if (!['active', 'paused', 'archived'].includes(status)) throw bad('status must be active, paused or archived');
    if (Object.keys(req.body).some((k) => k !== 'status')) throw bad('Goals cannot be edited; archive it and add a new goal');
    const { rows: prev } = await db.query(`SELECT status FROM goal WHERE id = $1 AND ${viaClient}`, [req.params.id, req.clinician.id]);
    if (!prev.length) throw new HttpError(404, 'Not found');
    const row = await updateRow(req, 'goal', req.params.id, { status }, viaClient);
    if (prev[0].status !== status) {
      await db.query('INSERT INTO goal_status_change (goal_id, from_status, to_status, change_made_datetime) VALUES ($1, $2, $3, $4)',
        [row.id, prev[0].status, status, now()]);
    }
    await audit(req, status === 'archived' ? 'archive' : 'status', 'goal', row.id, { status });
    res.json(row);
  });

  // ---- Chart data and annotations (SPEC 5.5) ----
  const RANGE_DAYS = { week: 7, month: 30, '3months': 91 };
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  /** Lower/upper date bounds for a request: an explicit from/to (specific month or week) wins over the preset range. */
  const rangeBounds = (q) => {
    if (ISO_DATE.test(q.from) && ISO_DATE.test(q.to)) return { since: q.from, until: q.to };
    const days = RANGE_DAYS[q.range];
    return { since: (days ? new Date(now().getTime() - days * 864e5) : new Date(0)).toISOString().slice(0, 10), until: '9999-12-31' };
  };

  /** improving / flat / declining from the first vs second half of answered values. Missing replies are ignored. */
  const trendOf = (points, type) => {
    const vals = points.filter((p) => p.answered).map((p) => (type === 'yes_no' ? (p.value_bool ? 100 : 0) : p.value_minutes));
    if (vals.length < 4) return 'not_enough_data';
    const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const mid = Math.floor(vals.length / 2);
    const d = avg(vals.slice(mid)) - avg(vals.slice(0, mid));
    const eps = type === 'yes_no' ? 10 : 5;
    return d > eps ? 'improving' : d < -eps ? 'declining' : 'flat';
  };

  app.get('/api/goals/:id/series', async (req, res) => {
    const { rows: g } = await db.query(`SELECT * FROM goal WHERE id = $1 AND ${viaClient}`, [req.params.id, req.clinician.id]);
    if (!g.length) throw new HttpError(404, 'Not found');
    const { since, until } = rangeBounds(req.query);
    const { rows: points } = await db.query(
      `SELECT p.id AS prompt_id, p.prompt_date::text AS date, p.status, r.id AS response_id, r.value_bool, r.value_minutes, r.source,
              (r.id IS NOT NULL) AS answered
         FROM prompt p
         LEFT JOIN LATERAL (SELECT * FROM response WHERE prompt_id = p.id AND parse_status <> 'unparsed' ORDER BY received_at DESC LIMIT 1) r ON true
        WHERE p.goal_id = $1 AND p.prompt_date >= $2::date AND p.prompt_date <= $3::date ORDER BY p.prompt_date, p.scheduled_for`,
      [req.params.id, since, until],
    );
    const { rows: annotations } = await db.query('SELECT id, date::text AS date, text FROM annotation WHERE goal_id = $1 ORDER BY date', [req.params.id]);
    res.json({ goal: g[0], points, annotations, trend: trendOf(points, g[0].response_type) });
  });

  // Response log: one row per prompt with a dated timeline of what was sent and what the parent did (SPEC 5.4).
  app.get('/api/clients/:id/response-log', async (req, res) => {
    await ownedClient(req, req.params.id);
    const { since, until } = rangeBounds(req.query);
    const { rows: prompts } = await db.query(
      `SELECT p.id, p.goal_id, g.title AS goal_title, g.response_type, ct.name AS contact_name, p.prompt_date::text AS date,
              p.scheduled_for, p.sent_at, p.status, p.followups_sent, p.last_followup_at
         FROM prompt p JOIN goal g ON g.id = p.goal_id JOIN contact ct ON ct.id = g.contact_id
        WHERE g.client_id = $1 AND p.prompt_date >= $2::date AND p.prompt_date <= $3::date AND p.status NOT IN ('scheduled', 'deferred')
        ORDER BY p.scheduled_for DESC LIMIT 300`,
      [req.params.id, since, until]);
    const ids = prompts.map((p) => p.id);
    const { rows: msgs } = ids.length ? await db.query(
      `SELECT prompt_id, direction, status, body, created_at FROM message_log
        WHERE prompt_id = ANY($1::uuid[]) AND status <> 'refused' ORDER BY created_at, id`, [ids]) : { rows: [] };
    const { rows: resps } = ids.length ? await db.query(
      `SELECT prompt_id, received_at, value_bool, value_minutes, source FROM response
        WHERE prompt_id = ANY($1::uuid[]) AND parse_status <> 'unparsed' ORDER BY received_at`, [ids]) : { rows: [] };
    const entries = prompts.map((p) => {
      const events = [];
      let outbound = 0;
      for (const m of msgs.filter((x) => x.prompt_id === p.id)) {
        if (m.direction === 'outbound') {
          const reprompt = /^Sorry, I couldn't read/.test(m.body ?? '');
          events.push({ at: m.created_at, kind: reprompt ? 'reprompt' : outbound++ === 0 ? 'prompt' : 'followup' });
        } else if (m.status === 'unparsed') events.push({ at: m.created_at, kind: 'unreadable', text: m.body });
      }
      // Prompts with no message log (older data): fall back to the prompt row itself.
      if (!events.some((e) => e.kind === 'prompt') && p.sent_at) events.push({ at: p.sent_at, kind: 'prompt' });
      if (!events.some((e) => e.kind === 'followup') && p.followups_sent && p.last_followup_at) events.push({ at: p.last_followup_at, kind: 'followup' });
      for (const r of resps.filter((x) => x.prompt_id === p.id)) {
        events.push({ at: r.received_at, kind: 'reply', source: r.source, value_bool: r.value_bool, value_minutes: r.value_minutes });
      }
      events.sort((a, b) => new Date(a.at) - new Date(b.at));
      const reply = [...events].reverse().find((e) => e.kind === 'reply');
      const sentAt = events.find((e) => e.kind === 'prompt')?.at ?? p.sent_at;
      return {
        prompt_id: p.id, goal_id: p.goal_id, goal_title: p.goal_title, response_type: p.response_type, contact_name: p.contact_name,
        date: p.date, status: p.status, sent_at: sentAt,
        followups: events.filter((e) => e.kind === 'followup').length,
        reprompts: events.filter((e) => e.kind === 'reprompt').length,
        replied_at: reply?.at ?? null,
        reply_minutes: reply && sentAt ? Math.round((new Date(reply.at) - new Date(sentAt)) / 6e4) : null,
        events,
      };
    });
    res.json({
      summary: {
        total: entries.length,
        answered: entries.filter((r) => r.replied_at).length,
        no_response: entries.filter((r) => r.status === 'no_response' && !r.replied_at).length,
        needed_followup: entries.filter((r) => r.followups > 0).length,
        needed_reprompt: entries.filter((r) => r.reprompts > 0).length,
      },
      entries,
    });
  });

  app.post('/api/goals/:id/annotations', async (req, res) => {
    const { rows } = await db.query(`SELECT 1 FROM goal WHERE id = $1 AND ${viaClient}`, [req.params.id, req.clinician.id]);
    if (!rows.length) throw new HttpError(404, 'Not found');
    const text = String(req.body?.text ?? '').trim();
    if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(req.body?.date ?? '')) throw bad('date (YYYY-MM-DD) and text are required');
    const row = await insertRow('annotation', { goal_id: req.params.id, date: req.body.date, text });
    await audit(req, 'create', 'annotation', row.id);
    res.status(201).json(row);
  });

  // ---- Manual data entry / resolving unparsed replies (SPEC 5.5, 5.7); always with an audit note ----
  const valueFrom = (body, responseType) => {
    if (responseType === 'yes_no') {
      if (typeof body.value_bool !== 'boolean') throw bad('value_bool (true/false) is required');
      return { value_bool: body.value_bool, value_minutes: null };
    }
    if (!Number.isInteger(body.value_minutes) || body.value_minutes < 0 || body.value_minutes > 1440) throw bad('value_minutes must be a whole number from 0 to 1440');
    return { value_bool: null, value_minutes: body.value_minutes };
  };

  app.post('/api/prompts/:id/response', async (req, res) => {
    const { rows } = await db.query(
      `SELECT g.response_type FROM prompt p JOIN goal g ON g.id = p.goal_id JOIN client c ON c.id = g.client_id
        WHERE p.id = $1 AND c.clinician_id = $2`, [req.params.id, req.clinician.id]);
    if (!rows.length) throw new HttpError(404, 'Not found');
    const v = valueFrom(req.body, rows[0].response_type);
    const row = await insertRow('response', { prompt_id: req.params.id, ...v, source: 'manual' });
    await db.query(`UPDATE prompt SET status = 'answered' WHERE id = $1`, [req.params.id]);
    await audit(req, 'manual_response', 'response', row.id);
    res.status(201).json(row);
  });

  app.patch('/api/responses/:id', async (req, res) => {
    const { rows } = await db.query(
      `SELECT r.prompt_id, g.response_type FROM response r JOIN prompt p ON p.id = r.prompt_id JOIN goal g ON g.id = p.goal_id
         JOIN client c ON c.id = g.client_id WHERE r.id = $1 AND c.clinician_id = $2`, [req.params.id, req.clinician.id]);
    if (!rows.length) throw new HttpError(404, 'Not found');
    const v = valueFrom(req.body, rows[0].response_type);
    const { rows: out } = await db.query(
      `UPDATE response SET value_bool = $2, value_minutes = $3, parse_status = 'reviewed'
        WHERE id = $1 RETURNING *`,
      [req.params.id, v.value_bool, v.value_minutes],
    );
    await db.query(`UPDATE prompt SET status = 'answered' WHERE id = $1`, [rows[0].prompt_id]);
    await audit(req, 'review_response', 'response', req.params.id);
    res.json(out[0]);
  });

  // ---- Progress reports (SPEC 5.6); the parent's /r/:token link is outside /api, so it is not locked ----
  reportRoutes({ app, db, messenger, config, now, HttpError, bad, audit, ownedClient, insertRow })();

  // ---- Static dashboard + errors ----
  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));

  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'File is too large (10 MB maximum)' });
    if (err.code === '23505' || err.code === '23514' || err.code === '23503' || err.code === '22P02') return res.status(400).json({ error: 'Invalid data' });
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  });

  return app;
}
