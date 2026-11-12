// Progress reports (SPEC 5.6): content builder and PDF renderer. Pure functions of the database
// and the report content; nothing here sends anything.
import PDFDocument from 'pdfkit';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 366;
const dayNum = (d) => Date.parse(`${d}T00:00:00Z`) / 864e5;
const isoOf = (n) => new Date(n * 864e5).toISOString().slice(0, 10);

/** Validates a period; returns {start, end} or throws an Error with a message fit to show Totty. */
export function checkPeriod(type, start, end) {
  if (!['weekly', 'monthly', 'custom'].includes(type)) throw new Error('period_type must be weekly, monthly or custom');
  if (!DATE.test(start ?? '') || !DATE.test(end ?? '') || Number.isNaN(dayNum(start)) || Number.isNaN(dayNum(end))) throw new Error('start and end dates (YYYY-MM-DD) are required');
  if (end < start) throw new Error('End date is before start date');
  if (dayNum(end) - dayNum(start) + 1 > MAX_DAYS) throw new Error('A report can cover at most one year');
  if (type === 'weekly' && (new Date(`${start}T00:00:00Z`).getUTCDay() !== 0 || dayNum(end) - dayNum(start) !== 6)) throw new Error('A weekly report runs Sunday to Saturday');
  if (type === 'monthly') {
    const s = new Date(`${start}T00:00:00Z`);
    const last = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    if (start.slice(8) !== '01' || end !== last) throw new Error('A monthly report covers a whole calendar month');
  }
  return { start, end };
}

/** The most recent completed Sunday-Saturday week relative to `today` (YYYY-MM-DD, client-local). */
export function lastCompletedWeek(today) {
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  const back = ((dow + 1) % 7) || 7; // Saturday is complete only once it has ended, so on a Saturday use the one before
  const sat = dayNum(today) - back;
  return { start: isoOf(sat - 6), end: isoOf(sat) };
}

async function pointsFor(db, goalId, start, end) {
  const { rows } = await db.query(
    `SELECT p.prompt_date::text AS date, (r.id IS NOT NULL) AS answered, r.value_bool, r.value_minutes
       FROM prompt p
       LEFT JOIN LATERAL (SELECT * FROM response WHERE prompt_id = p.id AND parse_status <> 'unparsed' ORDER BY received_at DESC LIMIT 1) r ON true
      WHERE p.goal_id = $1 AND p.prompt_date BETWEEN $2::date AND $3::date AND p.status IN ('answered', 'no_response', 'sent')
      ORDER BY p.prompt_date, p.scheduled_for`,
    [goalId, start, end],
  );
  return rows;
}

/** Metric over answered replies only: missing replies are never counted as No (SPEC 5.5). */
function metric(points, type) {
  const answered = points.filter((p) => p.answered);
  if (!answered.length) return null;
  return type === 'yes_no'
    ? Math.round((100 * answered.filter((p) => p.value_bool).length) / answered.length)
    : Math.round(answered.reduce((s, p) => s + p.value_minutes, 0) / answered.length);
}

/**
 * Report content for one client and period. Includes every active goal (even with no replies) plus any
 * other goal that was asked something in the period.
 */
export async function buildContent(db, client, { type, start, end }) {
  const len = dayNum(end) - dayNum(start) + 1;
  const priorEnd = isoOf(dayNum(start) - 1);
  const priorStart = isoOf(dayNum(start) - len);
  const { rows: goals } = await db.query(
    `SELECT g.* FROM goal g WHERE g.client_id = $1 AND (g.status = 'active' OR EXISTS
       (SELECT 1 FROM prompt p WHERE p.goal_id = g.id AND p.prompt_date BETWEEN $2::date AND $3::date))
     ORDER BY g.created_at, g.id`,
    [client.id, start, end],
  );
  const out = [];
  for (const g of goals) {
    const points = await pointsFor(db, g.id, start, end);
    const prior = await pointsFor(db, g.id, priorStart, priorEnd);
    const m = metric(points, g.response_type);
    const pm = metric(prior, g.response_type);
    const { rows: annotations } = await db.query(
      'SELECT date::text AS date, text FROM annotation WHERE goal_id = $1 AND date BETWEEN $2::date AND $3::date ORDER BY date', [g.id, start, end]);
    out.push({
      goal_id: g.id, title: g.title, response_type: g.response_type, status: g.status, target_json: g.target_json,
      asked: points.length, received: points.filter((p) => p.answered).length,
      metric: m, prior_metric: pm, change: m != null && pm != null ? Math.round((m - pm) * 10) / 10 : null,
      points, annotations,
      remark: '',
    });
  }
  return {
    client: { first_name: client.first_name, last_name: client.last_name },
    period: { type, start, end }, prior: { start: priorStart, end: priorEnd },
    goals: out, next_focus: '',
  };
}

export const metricLabel = (g) => (g.metric == null ? 'No replies yet' : g.response_type === 'yes_no' ? `${g.metric}% yes` : `Average ${g.metric} min`);
export const changeLabel = (g) => (g.change == null ? 'No prior period to compare' : `${g.change > 0 ? '+' : ''}${g.change}${g.response_type === 'yes_no' ? ' points' : ''} vs prior period`);

// pdfkit's built-in fonts cover Latin-1 only; anything else would print as garbage, so show '?'.
const safe = (t) => String(t ?? '').replace(/[^\n\x20-\x7E -ÿ–—‘’“”•]/g, '?');

export function renderPdf(content, { note = '' } = {}) {
  const doc = new PDFDocument({ size: 'LETTER', margin: 54, info: { Title: `Progress report: ${content.client.first_name}` } });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  const W = doc.page.width - 108;

  doc.font('Helvetica-Bold').fontSize(20).text(safe(`${content.client.first_name} ${content.client.last_name}`));
  doc.font('Helvetica').fontSize(12).fillColor('#555').text(`Progress report: ${content.period.start} to ${content.period.end}`).fillColor('#000').moveDown();

  for (const g of content.goals) {
    if (doc.y > doc.page.height - 200) doc.addPage();
    doc.font('Helvetica-Bold').fontSize(13).text(safe(g.title));
    doc.font('Helvetica').fontSize(10).fillColor('#555')
      .text(`${g.received} of ${g.asked} replies received${g.status !== 'active' ? ` (${g.status})` : ''}`).fillColor('#000');
    doc.fontSize(11).text(`${metricLabel(g)} · ${changeLabel(g)}`);
    const target = g.target_json?.threshold;
    if (target != null) doc.fontSize(10).fillColor('#555').text(`Target: ${g.response_type === 'yes_no' ? `${target}% yes` : `average ${target} min`}`).fillColor('#000');
    smallChart(doc, g, W);
    for (const a of g.annotations) doc.fontSize(10).fillColor('#7a5300').text(`${a.date}: ${safe(a.text)}`, { indent: 8 }).fillColor('#000');
    if (g.remark) doc.fontSize(11).moveDown(0.3).text(safe(g.remark));
    doc.moveDown();
  }
  if (!content.goals.length) doc.fontSize(11).text('No goals were active in this period.').moveDown();
  if (note) doc.font('Helvetica-Bold').fontSize(12).text('Note from Totty').font('Helvetica').fontSize(11).text(safe(note)).moveDown();
  if (content.next_focus) doc.font('Helvetica-Bold').fontSize(12).text('Focus for next period').font('Helvetica').fontSize(11).text(safe(content.next_focus));
  doc.end();
  return done;
}

/** Daily marks: yes/no dots (green yes, red no, hollow grey = no reply) or a minutes line. */
function smallChart(doc, g, W) {
  const pts = g.points;
  if (!pts.length) return;
  const x0 = doc.x, y0 = doc.y + 6, h = 44;
  const step = Math.min(14, W / Math.max(pts.length, 1));
  const px = (i) => x0 + 4 + i * step;
  doc.save();
  doc.lineWidth(0.5).strokeColor('#ccc').rect(x0, y0, W, h).stroke();
  if (g.response_type === 'yes_no') {
    pts.forEach((p, i) => {
      const cx = px(i), cy = y0 + h / 2;
      if (!p.answered) doc.lineWidth(1).strokeColor('#888').circle(cx, cy, 3).stroke();
      else doc.fillColor(p.value_bool ? '#1b6e3c' : '#b3261e').circle(cx, cy, 3.5).fill();
    });
  } else {
    const top = Math.max(1, ...pts.filter((p) => p.answered).map((p) => p.value_minutes));
    const y = (v) => y0 + h - 4 - (v / top) * (h - 8);
    let first = true;
    doc.lineWidth(1).strokeColor('#2456c8');
    pts.forEach((p, i) => { if (!p.answered) return; if (first) { doc.moveTo(px(i), y(p.value_minutes)); first = false; } else doc.lineTo(px(i), y(p.value_minutes)); });
    doc.stroke();
    pts.forEach((p, i) => { if (p.answered) doc.fillColor('#2456c8').circle(px(i), y(p.value_minutes), 2).fill(); else doc.lineWidth(0.8).strokeColor('#888').circle(px(i), y0 + h - 3, 1.5).stroke(); });
  }
  doc.restore();
  doc.x = x0;
  doc.y = y0 + h + 6;
}
