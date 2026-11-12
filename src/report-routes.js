// Progress report routes (SPEC 5.6). Reports are created, edited and sent only by explicit clicks.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DateTime } from 'luxon';
import { ShabbosRefusal } from './messaging.js';
import { buildContent, checkPeriod, lastCompletedWeek, renderPdf } from './reports.js';

const sha256 = (t) => crypto.createHash('sha256').update(t).digest('hex');
const dateOnly = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

/**
 * Mounts the parent-facing secure link (public) and returns a function that mounts the clinician API.
 * The API part must be mounted after the login / Shabbos-lock middleware.
 */
export function reportRoutes({ app, db, messenger, config, now, HttpError, bad, audit, ownedClient, insertRow }) {
  const reportDir = config.reportsDir ?? path.join(process.cwd(), 'data', 'reports');
  const linkDays = config.reportLinkDays ?? 14;

  // Parent's link: no login, unguessable token, expires. Read-only, so it is not Shabbos-locked.
  app.get('/r/:token', async (req, res) => {
    const { rows } = await db.query('SELECT pdf_path, link_expires_at FROM report WHERE link_token_hash = $1', [sha256(req.params.token)]);
    const r = rows[0];
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' });
    if (!r?.pdf_path || new Date(r.link_expires_at) < now()) {
      return res.status(404).type('text/plain').send('This link is not valid or has expired. Please ask Totty for a new one.');
    }
    res.type('application/pdf').set('Content-Disposition', 'inline; filename="progress-report.pdf"').send(await fs.readFile(r.pdf_path));
  });

  return function mountApi() {
    const ownedReport = async (req, id) => {
      const { rows } = await db.query(
        'SELECT r.* FROM report r JOIN client c ON c.id = r.client_id WHERE r.id = $1 AND c.clinician_id = $2', [id, req.clinician.id]);
      if (!rows.length) throw new HttpError(404, 'Not found');
      return rows[0];
    };

    app.get('/api/clients/:id/reports', async (req, res) => {
      await ownedClient(req, req.params.id);
      const { rows: [client] } = await db.query('SELECT timezone FROM client WHERE id = $1', [req.params.id]);
      const { rows } = await db.query(
        `SELECT id, period_type, to_char(period_start, 'YYYY-MM-DD') AS period_start, to_char(period_end, 'YYYY-MM-DD') AS period_end,
                status, sent_at, created_at FROM report WHERE client_id = $1 ORDER BY period_end DESC, created_at DESC`, [req.params.id]);
      const today = DateTime.fromJSDate(now(), { zone: client.timezone }).toISODate();
      res.json({ reports: rows, default_period: { period_type: 'weekly', ...lastCompletedWeek(today) } });
    });

    app.post('/api/clients/:id/reports', async (req, res) => {
      await ownedClient(req, req.params.id);
      const { rows: [client] } = await db.query('SELECT * FROM client WHERE id = $1', [req.params.id]);
      let p;
      try { p = checkPeriod(req.body?.period_type, req.body?.period_start, req.body?.period_end); } catch (e) { throw bad(e.message); }
      const content = await buildContent(db, client, { type: req.body.period_type, ...p });
      const row = await insertRow('report', { client_id: client.id, period_type: req.body.period_type, period_start: p.start, period_end: p.end, content_json: content });
      await audit(req, 'create', 'report', row.id);
      res.status(201).json({ id: row.id });
    });

    const view = (r) => ({
      id: r.id, client_id: r.client_id, status: r.status, period_type: r.period_type, sent_at: r.sent_at,
      note: r.note ?? '', link_expires_at: r.link_expires_at, content: r.content_json,
    });

    app.get('/api/reports/:id', async (req, res) => {
      const r = await ownedReport(req, req.params.id);
      await audit(req, 'view', 'report', r.id);
      res.json(view(r));
    });

    // What Totty may edit while previewing: his note, next-period focus, and a remark per goal.
    app.patch('/api/reports/:id', async (req, res) => {
      const r = await ownedReport(req, req.params.id);
      if (r.status !== 'draft') throw new HttpError(409, 'This report has been finalized and can no longer be edited');
      const b = req.body ?? {};
      const text = (v, max) => {
        if (v == null) return '';
        if (typeof v !== 'string' || v.length > max) throw bad(`Text too long (max ${max} characters)`);
        return v;
      };
      const content = r.content_json;
      if ('next_focus' in b) content.next_focus = text(b.next_focus, 2000);
      for (const g of content.goals) {
        const e = b.goals?.[g.goal_id];
        if (!e) continue;
        if ('remark' in e) g.remark = text(e.remark, 2000);
      }
      const note = 'note' in b ? text(b.note, 4000) : r.note;
      const { rows } = await db.query('UPDATE report SET content_json = $2, note = $3 WHERE id = $1 RETURNING *', [r.id, JSON.stringify(content), note]);
      await audit(req, 'update', 'report', r.id);
      res.json(view(rows[0]));
    });

    app.get('/api/reports/:id/pdf', async (req, res) => {
      const r = await ownedReport(req, req.params.id);
      const pdf = r.pdf_path ? await fs.readFile(r.pdf_path) : await renderPdf(r.content_json, { note: r.note ?? '' });
      await audit(req, 'download', 'report', r.id);
      res.type('application/pdf').set('Content-Disposition', `attachment; filename="report-${dateOnly(r.period_start)}-to-${dateOnly(r.period_end)}.pdf"`).send(pdf);
    });

    app.post('/api/reports/:id/send', async (req, res) => {
      const r = await ownedReport(req, req.params.id);
      if (r.status === 'sent') throw new HttpError(409, 'This report was already sent');
      const { rows: [c] } = await db.query('SELECT * FROM contact WHERE id = $1 AND client_id = $2', [req.body?.contact_id, r.client_id]);
      if (!c) throw bad('Choose a contact of this client');
      if (!c.phone) throw bad('That contact has no mobile number');
      if (c.status !== 'active') throw bad('That contact is not active');
      if (!c.consent_given_at) throw bad('No consent to text is recorded for that contact');
      const base = config.publicUrl || (config.production ? null : 'http://localhost:3000');
      if (!base) throw new HttpError(503, 'PUBLIC_URL is not configured');
      const { rows: [client] } = await db.query('SELECT * FROM client WHERE id = $1', [r.client_id]);

      // Freeze the content, store the PDF and mint the link; undo all of it if the text cannot go out.
      const pdf = await renderPdf(r.content_json, { note: r.note ?? '' });
      await fs.mkdir(reportDir, { recursive: true });
      const file = path.join(reportDir, `${r.id}.pdf`);
      await fs.writeFile(file, pdf);
      const token = crypto.randomBytes(32).toString('base64url');
      const expires = new Date(now().getTime() + linkDays * 864e5);
      await db.query(`UPDATE report SET status = 'final', pdf_path = $2, link_token_hash = $3, link_expires_at = $4 WHERE id = $1`, [r.id, file, sha256(token), expires]);
      try {
        await messenger.send({
          client, settings: req.clinician.settings_json, to: c.phone, reportId: r.id,
          // Only the child's first name: no progress details in the text itself.
          body: `A progress report for ${client.first_name} is ready: ${base}/r/${token}`,
        });
      } catch (err) {
        await db.query(`UPDATE report SET status = 'draft', pdf_path = NULL, link_token_hash = NULL, link_expires_at = NULL WHERE id = $1`, [r.id]);
        await fs.rm(file, { force: true });
        if (err instanceof ShabbosRefusal) throw new HttpError(423, 'shabbos', { kind: err.window.kind, reopensAt: err.window.end });
        throw new HttpError(502, 'The text message could not be sent; nothing was sent');
      }
      await db.query(`UPDATE report SET status = 'sent', sent_at = $2 WHERE id = $1`, [r.id, now()]);
      await audit(req, 'send', 'report', r.id, { contact_id: c.id });
      res.json({ ok: true, link_expires_at: expires });
    });
  };
}
