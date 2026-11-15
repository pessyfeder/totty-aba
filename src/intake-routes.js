// Intake upload routes (SPEC 5.1a step 3, 5.7b). Mount after the login / Shabbos-lock middleware.
// Files arrive as the raw request body (filename in X-Filename), so no multipart dependency is needed.
import crypto from 'node:crypto';
import express from 'express';
import { ensureDraft } from './consult-email.js';
import { ALLOWED_EXT, MAX_UPLOAD_BYTES, applyFill, decrypt, encrypt, extOf, parseForm, planFill, safeFilename } from './intake.js';

export function intakeRoutes({ app, db, config, HttpError, bad, audit, ownedClient }) {
  const secret = config.documentKey ?? config.sessionSecret;
  const raw = express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES });

  /** Reads the uploaded file from the request: validated name, type, size. */
  const fileOf = (req) => {
    const filename = safeFilename(decodeURIComponent(req.get('X-Filename') ?? ''));
    const ext = extOf(filename);
    if (!ALLOWED_EXT[ext]) throw bad(`File type .${ext || '?'} is not allowed (allowed: ${Object.keys(ALLOWED_EXT).join(', ')})`);
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw bad('The file is empty');
    return { filename, content_type: ALLOWED_EXT[ext], buffer: req.body };
  };

  const storeDocument = async (clientId, kind, f) => {
    const id = crypto.randomUUID();
    await db.query(
      `INSERT INTO client_document (id, client_id, kind, filename, content_type, size_bytes, data) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, clientId, kind, f.filename, f.content_type, f.buffer.length, encrypt(secret, id, f.buffer)],
    );
    return id;
  };

  /** Upload moves the client to paperwork_received, but never backwards from a later stage.
   *  At paperwork_received the consultation email is drafted for Totty's approval (SPEC 5.7b). */
  const markReceived = async (clientId) => {
    const { rows } = await db.query(
      `UPDATE client SET intake_status = 'paperwork_received', updated_at = now()
        WHERE id = $1 AND intake_status IN ('inquiry', 'paperwork_sent') RETURNING id`, [clientId]);
    await ensureDraft(db, clientId);
    return rows.length > 0;
  };

  const loadWorld = async (clientId) => {
    const { rows: [client] } = await db.query(
      `SELECT first_name, last_name, gender, dob::text AS dob, location_name, notes FROM client WHERE id = $1`, [clientId]);
    const { rows: contacts } = await db.query('SELECT * FROM contact WHERE client_id = $1 ORDER BY id', [clientId]);
    return { client, contacts };
  };

  const readForm = (req) => {
    const f = fileOf(req);
    if (!['json', 'csv'].includes(extOf(f.filename))) throw bad('The intake form must be a .json or .csv export');
    let form;
    try { form = parseForm(f.filename, f.buffer); } catch (e) { throw bad(e.message); }
    if (!Object.keys(form.client).length && !form.contacts.length) throw bad('No intake fields were recognised in this form file');
    return { f, form };
  };

  /** Stores the form, fills the client's empty fields, advances status. Shared by "existing client" and "new client". */
  const ingestForm = async (req, clientId, f, form) => {
    const documentId = await storeDocument(clientId, 'form', f);
    const { client, contacts } = await loadWorld(clientId);
    const { fill, conflicts } = planFill(client, contacts, form);
    const filled = await applyFill(db, clientId, fill);
    const advanced = await markReceived(clientId);
    await audit(req, 'intake_form', 'client', clientId, { document_id: documentId, filled, conflicts: conflicts.map((c) => c.field), status_advanced: advanced });
    return { client_id: clientId, document_id: documentId, filled, conflicts, warnings: form.warnings, status_advanced: advanced };
  };

  // The returned intake form for an existing client: stored encrypted, then its answers fill the empty fields.
  app.post('/api/clients/:id/intake/form', raw, async (req, res) => {
    await ownedClient(req, req.params.id);
    const { f, form } = readForm(req);
    res.status(201).json(await ingestForm(req, req.params.id, f, form));
  });

  // Reads a returned intake form and gives back its answers without saving anything, so the Add client page can
  // pre-fill its fields. Nothing is stored until Totty clicks Create client.
  app.post('/api/intake/parse', raw, async (req, res) => {
    const { form } = readForm(req);
    res.json(form);
  });

  // The returned intake form with no client yet: the form creates the client (SPEC 5.1a step 3).
  // The form has no coordinates or timezone, so the new client starts with Totty's own (they drive the Shabbos
  // window, SPEC 5.3); the response flags this so he can set the family's real location.
  app.post('/api/intake/form', raw, async (req, res) => {
    const { f, form } = readForm(req);
    const { first_name, last_name } = form.client;
    if (!first_name || !last_name) throw bad("The form needs the child's first and last name to create a client");
    const me = req.clinician;
    if (me.latitude == null || me.longitude == null) throw bad('Set your own location before creating clients from a form');
    const { rows: dup } = await db.query(
      `SELECT id FROM client WHERE clinician_id = $1 AND lower(first_name) = lower($2) AND lower(last_name) = lower($3) LIMIT 1`,
      [me.id, first_name, last_name]);
    if (dup.length) throw new HttpError(409, `${first_name} ${last_name} already exists; open that client and upload the form there`, { client_id: dup[0].id });
    const { rows: [c] } = await db.query(
      `INSERT INTO client (clinician_id, first_name, last_name, admission_date, latitude, longitude, timezone, in_israel, intake_status)
       VALUES ($1, $2, $3, current_date, $4, $5, $6, $7, 'paperwork_received') RETURNING id`,
      [me.id, first_name, last_name, me.latitude, me.longitude, me.timezone, me.in_israel]);
    await audit(req, 'create', 'client', c.id, { via: 'intake_form' });
    const out = await ingestForm(req, c.id, f, form);
    res.status(201).json({ ...out, created: true, location_defaulted: true });
  });

  // Any other returned document (consent, insurance, assessments...): attached to the client.
  app.post('/api/clients/:id/documents', raw, async (req, res) => {
    await ownedClient(req, req.params.id);
    const f = fileOf(req);
    const documentId = await storeDocument(req.params.id, 'document', f);
    const advanced = await markReceived(req.params.id);
    await audit(req, 'upload', 'client_document', documentId, { client_id: req.params.id, status_advanced: advanced });
    res.status(201).json({ document_id: documentId, status_advanced: advanced });
  });

  // Documents on the client, plus open disagreements between the latest form and what is on the client now.
  app.get('/api/clients/:id/intake', async (req, res) => {
    await ownedClient(req, req.params.id);
    const { rows: documents } = await db.query(
      `SELECT id, kind, filename, content_type, size_bytes, uploaded_at FROM client_document WHERE client_id = $1 ORDER BY uploaded_at DESC`, [req.params.id]);
    let conflicts = [];
    const { rows: [latest] } = await db.query(
      `SELECT id, filename, data FROM client_document WHERE client_id = $1 AND kind = 'form' ORDER BY uploaded_at DESC LIMIT 1`, [req.params.id]);
    if (latest) {
      const { client, contacts } = await loadWorld(req.params.id);
      conflicts = planFill(client, contacts, parseForm(latest.filename, decrypt(secret, latest.id, latest.data))).conflicts;
    }
    await audit(req, 'view', 'client_document', null, { client_id: req.params.id, list: true });
    res.json({ documents, conflicts });
  });

  app.get('/api/documents/:id', async (req, res) => {
    const { rows } = await db.query(
      `SELECT d.* FROM client_document d JOIN client c ON c.id = d.client_id WHERE d.id = $1 AND c.clinician_id = $2`, [req.params.id, req.clinician.id]);
    if (!rows.length) throw new HttpError(404, 'Not found');
    const d = rows[0];
    await audit(req, 'download', 'client_document', d.id, { client_id: d.client_id });
    res.set({
      'Content-Type': d.content_type,
      'Content-Disposition': `attachment; filename="${d.filename.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(d.filename)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    }).send(decrypt(secret, d.id, d.data));
  });
}
