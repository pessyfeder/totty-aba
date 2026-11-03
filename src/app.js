// HTTP API for Totty's web app. Every /api route except /api/status is locked during Shabbos / Yom Tov
// (SPEC 5.3): the server refuses, not just the buttons. Twilio webhooks are never locked.
import express from 'express';
import { fileURLToPath } from 'node:url';
import { COOKIE, createSession, readSession, parseCookies, verifyPassword } from './auth.js';
import { locationFrom, windowAt } from './shabbos.js';
import { loadDashboard } from './dashboard.js';
import { handleInbound } from './inbound.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLIENT_FIELDS = ['first_name', 'last_name', 'gender', 'dob', 'admission_date', 'notes', 'location_name', 'latitude', 'longitude', 'timezone', 'in_israel', 'candle_lighting_minutes'];
const CONTACT_FIELDS = ['name', 'relationship', 'phone', 'email', 'preferred_channel', 'language', 'status', 'consent_given_at', 'consent_note'];
const GOAL_FIELDS = ['contact_id', 'title', 'description', 'question_text', 'response_type', 'channel', 'schedule_json', 'date_added', 'start_date', 'end_date', 'status', 'target_json'];
const INCENTIVE_FIELDS = ['name', 'note'];

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
const bad = (msg) => new HttpError(400, msg);

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

export function createApp({ db, messenger, config, now = () => new Date() }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false }));

  app.param('id', (req, res, next, id) => (UUID.test(id) ? next() : next(new HttpError(404, 'Not found'))));

  // ---- Twilio inbound webhook: always accepted, never locked ----
  app.post('/webhooks/twilio/sms', async (req, res) => {
    if (config.twilio?.authToken) {
      const { default: twilio } = await import('twilio');
      const ok = twilio.validateRequest(config.twilio.authToken, req.get('X-Twilio-Signature') ?? '', `${config.publicUrl}/webhooks/twilio/sms`, req.body);
      if (!ok) return res.status(403).end();
    } else if (config.production) {
      return res.status(503).end(); // refuse unsigned webhooks in production
    }
    await handleInbound({ db, messenger, from: req.body.From, body: req.body.Body ?? '', providerId: req.body.MessageSid ?? null, now: now() });
    res.type('text/xml').send('<Response/>');
  });

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

  app.post('/api/clients', async (req, res) => {
    const f = pick(req.body, CLIENT_FIELDS);
    checkClient(f, { partial: false });
    const row = await insertRow('client', { ...f, clinician_id: req.clinician.id });
    await audit(req, 'create', 'client', row.id);
    res.status(201).json(row);
  });

  app.get('/api/clients/:id', async (req, res) => {
    const { rows } = await db.query('SELECT * FROM client WHERE id = $1 AND clinician_id = $2', [req.params.id, req.clinician.id]);
    if (!rows.length) throw new HttpError(404, 'Not found');
    const [contacts, goals, incentives] = await Promise.all(
      ['contact', 'goal', 'incentive'].map((t) => db.query(`SELECT * FROM ${t} WHERE client_id = $1 ORDER BY 1`, [req.params.id]).then((r) => r.rows)),
    );
    await audit(req, 'view', 'client', req.params.id);
    res.json({ ...rows[0], contacts, goals, incentives });
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

  // ---- Incentives (record only, SPEC 5.6a) ----
  app.post('/api/clients/:id/incentives', async (req, res) => {
    await ownedClient(req, req.params.id);
    const f = pick(req.body, INCENTIVE_FIELDS);
    if (!f.name) throw bad('name is required');
    res.status(201).json(await insertRow('incentive', { ...f, client_id: req.params.id }));
  });
  app.patch('/api/incentives/:id', async (req, res) =>
    res.json(await updateRow(req, 'incentive', req.params.id, pick(req.body, INCENTIVE_FIELDS), viaClient)));
  app.delete('/api/incentives/:id', async (req, res) => {
    const { rows } = await db.query(`DELETE FROM incentive WHERE id = $1 AND ${viaClient} RETURNING id`, [req.params.id, req.clinician.id]);
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
    const row = await updateRow(req, 'contact', req.params.id, pick(req.body, CONTACT_FIELDS), viaClient);
    await audit(req, 'update', 'contact', row.id, { fields: Object.keys(pick(req.body, CONTACT_FIELDS)) });
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
  app.patch('/api/goals/:id', async (req, res) => {
    const f = pick(req.body, GOAL_FIELDS);
    checkGoal(f, { partial: true });
    const row = await updateRow(req, 'goal', req.params.id, f, viaClient);
    await audit(req, 'update', 'goal', row.id, { fields: Object.keys(f) });
    res.json(row);
  });

  // ---- Manual data entry / resolving unparsed replies (SPEC 5.5, 5.7); always with an audit note ----
  const valueFrom = (body, responseType) => {
    if (!body?.audit_note) throw bad('audit_note is required');
    if (responseType === 'yes_no') {
      if (typeof body.value_bool !== 'boolean') throw bad('value_bool (true/false) is required');
      return { value_bool: body.value_bool, value_int: null };
    }
    if (!Number.isInteger(body.value_int) || body.value_int < 0 || body.value_int > 5) throw bad('value_int must be 0-5');
    return { value_bool: null, value_int: body.value_int };
  };

  app.post('/api/prompts/:id/response', async (req, res) => {
    const { rows } = await db.query(
      `SELECT g.response_type FROM prompt p JOIN goal g ON g.id = p.goal_id JOIN client c ON c.id = g.client_id
        WHERE p.id = $1 AND c.clinician_id = $2`, [req.params.id, req.clinician.id]);
    if (!rows.length) throw new HttpError(404, 'Not found');
    const v = valueFrom(req.body, rows[0].response_type);
    const row = await insertRow('response', { prompt_id: req.params.id, ...v, comment: req.body.comment ?? null, source: 'manual', audit_note: req.body.audit_note });
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
      `UPDATE response SET value_bool = $2, value_int = $3, comment = COALESCE($4, comment), parse_status = 'reviewed', audit_note = $5
        WHERE id = $1 RETURNING *`,
      [req.params.id, v.value_bool, v.value_int, req.body.comment ?? null, req.body.audit_note],
    );
    await db.query(`UPDATE prompt SET status = 'answered' WHERE id = $1`, [rows[0].prompt_id]);
    await audit(req, 'review_response', 'response', req.params.id);
    res.json(out[0]);
  });

  // ---- Static dashboard + errors ----
  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));

  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    if (err.code === '23505' || err.code === '23514' || err.code === '23503' || err.code === '22P02') return res.status(400).json({ error: 'Invalid data' });
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  });

  return app;
}
