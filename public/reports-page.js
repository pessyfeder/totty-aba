// Reports UI (SPEC 5.6): create on a client's page, preview/edit, download or send. Nothing happens automatically.
import { chartFor } from './charts.js';

const fmtDate = (d) => new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
const STATUS = { draft: 'Draft', final: 'Finalized', sent: 'Sent' };
const metricLabel = (g) => (g.metric == null ? 'No replies yet' : g.response_type === 'yes_no' ? `${g.metric}% yes` : `Average ${g.metric} of 5`);
const changeLabel = (g) => (g.change == null ? 'No prior period to compare' : `${g.change > 0 ? '+' : ''}${g.change}${g.response_type === 'yes_no' ? ' points' : ''} vs prior period`);

const monthBounds = (iso) => {
  const [y, m] = iso.split('-').map(Number);
  const pad = (n) => String(n).padStart(2, '0');
  return { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}` };
};

/** "Reports" section for the client page: Create report + history. */
export async function reportsSection({ h, api, handle }, clientId) {
  const { reports, default_period: dp } = await api(`/clients/${clientId}/reports`);
  const msg = h('span', { class: 'error', role: 'alert' });
  const type = h('select', { name: 'period_type', 'aria-label': 'Period' },
    [['biweekly', 'Bi-weekly (14 days, Sun–Sat)'], ['monthly', 'Monthly'], ['custom', 'Custom dates']].map(([v, t]) => h('option', { value: v }, t)));
  const start = h('input', { name: 'start', type: 'date', value: dp.start, required: true, 'aria-label': 'Start date' });
  const end = h('input', { name: 'end', type: 'date', value: dp.end, required: true, 'aria-label': 'End date' });
  // Bi-weekly and monthly snap the dates to whole periods; custom leaves them alone.
  const snap = () => {
    if (type.value === 'biweekly' && start.value) {
      const d = new Date(`${start.value}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - d.getUTCDay());
      start.value = d.toISOString().slice(0, 10);
      d.setUTCDate(d.getUTCDate() + 13);
      end.value = d.toISOString().slice(0, 10);
    } else if (type.value === 'monthly' && start.value) {
      const b = monthBounds(start.value);
      start.value = b.start; end.value = b.end;
    }
    end.disabled = type.value !== 'custom';
  };
  type.addEventListener('change', snap);
  start.addEventListener('change', snap);
  snap();
  const form = h('form', { class: 'inline-form', onsubmit: async (e) => {
    e.preventDefault();
    msg.textContent = '';
    try {
      const r = await api(`/clients/${clientId}/reports`, { method: 'POST', body: { period_type: type.value, period_start: start.value, period_end: end.value } });
      location.hash = `#/report/${r.id}`;
    } catch (ex) { msg.textContent = ex.message; }
  } }, h('label', {}, 'Period', type), h('label', {}, 'From', start), h('label', {}, 'To', end), h('button', { type: 'submit' }, 'Create report'), msg);

  return h('section', {},
    h('h2', {}, 'Progress reports'),
    form,
    reports.length
      ? h('ul', {}, reports.map((r) => h('li', {}, h('a', { href: `#/report/${r.id}` }, `${fmtDate(r.period_start)} – ${fmtDate(r.period_end)}`), ` · ${r.period_type} · ${STATUS[r.status]}${r.sent_at ? ` ${fmtDate(r.sent_at)}` : ''}`)))
      : h('p', { class: 'muted' }, 'No reports yet. Nothing is created or sent until you click Create report.'));
}

export async function renderReport({ h, api, app, logoutBtn, handle }, id) {
  const r = await api(`/reports/${id}`);
  const client = await api(`/clients/${r.client_id}`);
  logoutBtn.hidden = false;
  const c = r.content;
  const draft = r.status === 'draft';
  const reload = () => renderReport({ h, api, app, logoutBtn, handle }, id).catch(handle);
  const msg = h('p', { class: 'error', role: 'alert' });

  const inputs = new Map(); // goal_id -> { remark }
  const goalBlocks = c.goals.map((g) => {
    const remark = h('textarea', { rows: 2, 'aria-label': `Remark on ${g.title}`, disabled: !draft }, g.remark ?? '');
    inputs.set(g.goal_id, { remark });
    const chart = chartFor(g, g.points, g.annotations);
    return h('article', { class: 'card goal-card' },
      h('h3', {}, g.title),
      h('div', { class: 'muted' }, `${g.received} of ${g.asked} replies received${g.status !== 'active' ? ` · ${g.status}` : ''}`),
      h('p', {}, h('strong', {}, metricLabel(g)), ` · ${changeLabel(g)}`),
      chart ?? h('p', { class: 'muted' }, 'No prompts in this period.'),
      h('label', {}, 'Your remark (optional)', remark));
  });

  const note = h('textarea', { rows: 3, disabled: !draft }, r.note ?? '');
  const focus = h('textarea', { rows: 2, disabled: !draft }, c.next_focus ?? '');
  const collect = () => ({
    note: note.value, next_focus: focus.value,
    goals: Object.fromEntries(c.goals.map((g) => {
      const x = inputs.get(g.goal_id);
      return [g.goal_id, { remark: x.remark.value }];
    })),
  });
  const save = () => api(`/reports/${id}`, { method: 'PATCH', body: collect() });

  const eligible = client.contacts.filter((p) => p.email && !p.email_bounced_at && p.status === 'active' && p.consent_given_at);
  const who = h('select', { name: 'contact', 'aria-label': 'Send to' }, eligible.map((p) => h('option', { value: p.id }, `${p.name} (${p.email})`)));
  const actions = !draft
    ? h('p', { class: 'muted' }, r.status === 'sent'
        ? `Sent ${fmtDate(r.sent_at)}. The link expires ${fmtDate(r.link_expires_at)}. This report can no longer be edited.` : 'Finalized.')
    : h('div', { class: 'inline-form' },
        h('button', { type: 'button', onclick: async () => { msg.textContent = ''; try { await save(); msg.textContent = 'Saved.'; msg.className = 'muted'; } catch (ex) { msg.className = 'error'; msg.textContent = ex.message; } } }, 'Save changes'),
        h('button', { type: 'button', onclick: async () => {
          msg.className = 'error'; msg.textContent = '';
          try { await save(); location.href = `/api/reports/${id}/pdf`; } catch (ex) { msg.textContent = ex.message; }
        } }, 'Download PDF'),
        eligible.length
          ? h('span', { class: 'inline-form' }, who, h('button', { type: 'button', onclick: async () => {
              const p = eligible.find((x) => x.id === who.value);
              if (!confirm(`Email a link to this report to ${p.name} at ${p.email}? It goes out right now and cannot be undone or edited afterwards.`)) return;
              msg.className = 'error'; msg.textContent = '';
              try { await save(); await api(`/reports/${id}/send`, { method: 'POST', body: { contact_id: p.id } }); await reload(); } catch (ex) { msg.textContent = ex.message; }
            } }, 'Send to parent'))
          : h('span', { class: 'muted' }, 'To send, add a contact with an email address and recorded consent (client page > Edit contacts).'));

  app.replaceChildren(
    h('p', {}, h('a', { href: `#/client/${r.client_id}` }, `← ${c.client.first_name} ${c.client.last_name}`)),
    h('h2', {}, `Progress report · ${STATUS[r.status]}`),
    h('p', { class: 'muted' }, `${c.client.first_name} ${c.client.last_name} · ${fmtDate(c.period.start)} – ${fmtDate(c.period.end)} · compared with ${fmtDate(c.prior.start)} – ${fmtDate(c.prior.end)}`),
    ...(c.goals.length ? goalBlocks : [h('p', { class: 'muted' }, 'No goals were active in this period.')]),
    h('label', {}, 'Note from you (optional)', note),
    h('label', {}, 'Focus for next period (optional)', focus),
    actions, msg);
}
