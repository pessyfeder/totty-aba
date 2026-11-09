// Client page: contacts, goals, per-goal charts, notes (SPEC 5.1, 5.2, 5.5, 5.6a).
import { chartFor } from './charts.js';
import { reportsSection } from './reports-page.js';

const RANGES = [['week', '1 week'], ['month', '1 month'], ['3months', '3 months'], ['all', 'All']];
const TREND = { improving: 'Improving', flat: 'Flat', declining: 'Declining', not_enough_data: 'Not enough data yet' };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const today = () => new Date().toISOString().slice(0, 10);

/** Small form helper: runs onSubmit with the FormData and shows any error beside the button. */
function inlineForm(h, fields, submitLabel, onSubmit) {
  const msg = h('span', { class: 'error', role: 'alert' });
  const form = h('form', { class: 'inline-form', onsubmit: async (e) => {
    e.preventDefault();
    msg.textContent = '';
    try { await onSubmit(new FormData(form)); } catch (ex) { msg.textContent = ex.message; }
  } }, fields, h('button', { type: 'submit' }, submitLabel), msg);
  return form;
}
const trimmed = (f) => Object.fromEntries([...f.entries()].map(([k, v]) => [k, String(v).trim()]).filter(([, v]) => v !== ''));

function goalCard({ h, api, handle }, g, contacts, reload) {
  const lbl = (text, input) => h('label', {}, text, input);
  const body = h('div', {});
  const summary = h('div', { class: 'muted' }, 'Loading…');
  let range = 'month';
  const rangeBar = h('div', { class: 'range', role: 'group', 'aria-label': 'Chart range' });

  async function draw() {
    for (const b of rangeBar.children) b.setAttribute('aria-pressed', String(b.dataset.r === range));
    const d = await api(`/goals/${g.id}/series?range=${range}`);
    const answered = d.points.filter((p) => p.answered).length;
    summary.replaceChildren(`${answered} of ${d.points.length} replies · Trend: `, h('strong', { class: `trend-${d.trend}` }, TREND[d.trend]));
    const chart = chartFor(g, d.points, d.annotations);
    const legend = g.response_type === 'yes_no'
      ? ['● Yes', '● No', '○ No response (never counted as No)', '┄ Target', '┆ Note']
      : ['● Rating', '— 7-reply average', '○ No response', '┄ Target', '┆ Note'];
    body.replaceChildren(chart ?? h('p', { class: 'muted' }, 'No prompts in this range yet.'),
      chart ? h('div', { class: 'legend' }, legend.map((t) => h('span', {}, t))) : '');
  }
  for (const [r, label] of RANGES) {
    rangeBar.append(h('button', { type: 'button', 'data-r': r, onclick: () => { range = r; draw().catch(handle); } }, label));
  }

  const note = inlineForm(h, [
    lbl('Date', h('input', { name: 'date', type: 'date', value: today(), required: true })),
    lbl('Note on the chart', h('input', { name: 'text', placeholder: 'e.g. new intervention started', required: true })),
  ], 'Add note', async (f) => { await api(`/goals/${g.id}/annotations`, { method: 'POST', body: trimmed(f) }); await draw(); });

  const owner = contacts.find((c) => c.id === g.contact_id);
  const card = h('article', { class: 'card goal-card' },
    h('h3', {}, g.title),
    h('div', { class: 'muted' }, `${g.response_type === 'yes_no' ? 'Yes/No' : '0–5 rating'} · ${g.status} · asks ${owner?.name ?? 'contact'} at ${g.schedule_json.time} on ${g.schedule_json.days.map((d) => DAYS[d]).join(', ')}`),
    summary, rangeBar, body, g.status === 'archived' ? '' : note,
    g.status === 'archived' ? h('p', { class: 'muted' }, 'Archived: no more prompts. History is kept.') : h('div', {},
      h('button', { type: 'button', class: 'link', onclick: () => {
        const next = g.status === 'paused' ? 'active' : 'paused';
        api(`/goals/${g.id}`, { method: 'PATCH', body: { status: next } }).then(reload, handle);
      } }, g.status === 'paused' ? 'Resume prompts' : 'Pause prompts'),
      h('button', { type: 'button', class: 'link', onclick: () => {
        if (!confirm(`Archive "${g.title}"? Prompts stop for good and the goal can't be edited or restored. Its history is kept.`)) return;
        api(`/goals/${g.id}`, { method: 'PATCH', body: { status: 'archived' } }).then(reload, handle);
      } }, 'Archive goal')));
  draw().catch(handle);
  return card;
}

export async function renderClient(ctx, id) {
  const { h, api, app, logoutBtn, handle } = ctx;
  const c = await api(`/clients/${id}`);
  logoutBtn.hidden = false;
  const lbl = (text, input) => h('label', {}, text, input);
  const reload = () => renderClient(ctx, id).catch(handle);
  const post = (path, body) => api(`/clients/${id}${path}`, { method: 'POST', body }).then(reload);

  const goalForm = inlineForm(h, [
    lbl('Goal', h('input', { name: 'title', required: true, placeholder: 'e.g. Used words to ask for help' })),
    lbl('Question texted to parent (optional)', h('input', { name: 'question_text' })),
    lbl('Ask', h('select', { name: 'contact_id', required: true }, c.contacts.map((p) => h('option', { value: p.id }, p.name)))),
    lbl('Answer type', h('select', { name: 'response_type' }, h('option', { value: 'yes_no' }, 'Yes / No'), h('option', { value: 'rating' }, 'Rating 0–5'))),
    lbl('Time', h('input', { name: 'time', type: 'time', value: '18:30', required: true })),
    lbl('Start date', h('input', { name: 'start_date', type: 'date', value: today(), required: true })),
    lbl('Target (% yes or average rating, optional)', h('input', { name: 'target', type: 'number', min: 0, step: 'any' })),
    h('fieldset', {}, h('legend', {}, 'Days'), DAYS.map((d, i) => h('label', {}, h('input', { name: 'day', type: 'checkbox', value: i, checked: true }), ` ${d}`))),
  ], 'Add goal', async (f) => {
    const days = f.getAll('day').map(Number);
    const body = trimmed(f);
    for (const k of ['day', 'time', 'target']) delete body[k];
    const t = f.get('target');
    if (t) body.target_json = f.get('response_type') === 'yes_no' ? { type: 'percent_yes', threshold: Number(t) } : { type: 'avg_rating', threshold: Number(t) };
    await post('/goals', { ...body, channel: 'sms', schedule_json: { days, time: f.get('time') } });
  });

  const liveGoals = c.goals.filter((g) => g.status !== 'archived');
  const archivedGoals = c.goals.filter((g) => g.status === 'archived');

  const reinforcementForm = inlineForm(h, [lbl('Preferred reinforcement', h('input', { name: 'name', required: true, placeholder: 'e.g. bubbles' }))],
    'Add', (f) => post('/reinforcements', trimmed(f)));

  const reports = await reportsSection(ctx, id);

  app.replaceChildren(
    h('p', {}, h('a', { href: '#/' }, '← Dashboard')),
    h('h2', {}, `${c.first_name} ${c.last_name}`, ' ', h('a', { href: `#/client/${id}/edit`, class: 'button' }, 'Edit')),
    h('p', { class: 'muted' }, `Admitted ${String(c.admission_date).slice(0, 10)} · ${c.location_name ?? ''} · ${c.timezone}`),
    h('h2', {}, 'Preferred reinforcements'),
    c.reinforcements.length ? h('ul', { class: 'chips' }, c.reinforcements.map((i) => h('li', {}, i.name))) : h('p', { class: 'muted' }, 'None recorded'),
    reinforcementForm,
    h('h2', {}, 'Contacts'),
    h('ul', {}, c.contacts.map((p) => h('li', {}, `${p.name}${p.relationship ? ` (${p.relationship})` : ''} — ${p.phone ?? 'no phone'}, ${p.consent_given_at ? 'consent recorded' : 'no consent recorded'}, ${p.status}`))),
    h('p', {}, h('a', { href: `#/client/${id}/contacts`, class: 'button' }, 'Edit contacts')),
    h('h2', {}, 'Goals'),
    ...(liveGoals.length ? liveGoals.map((g) => goalCard(ctx, g, c.contacts, reload)) : [h('p', { class: 'muted' }, 'No goals yet.')]),
    c.contacts.length ? h('details', {}, h('summary', {}, 'Add a goal'), goalForm) : h('p', { class: 'muted' }, 'Add a contact (Edit contacts, above) before adding a goal.'),
    reports,
    archivedGoals.length ? h('details', {}, h('summary', {}, `Archived goals (${archivedGoals.length})`), ...archivedGoals.map((g) => goalCard(ctx, g, c.contacts, reload))) : '');
}
