// Client page: contacts, goals, per-goal charts, notes (SPEC 5.1, 5.2, 5.5, 5.6a).
import { chartFor } from './charts.js';
import { reportsSection } from './reports-page.js';

const RANGES = [['week', '1 week'], ['month', '1 month'], ['3months', '3 months'], ['all', 'All']];
const TREND = { improving: 'Improving', flat: 'Flat', declining: 'Declining', not_enough_data: 'Not enough data yet' };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const STATUS = { scheduled: 'Scheduled', deferred: 'Deferred', sending: 'Sending', sent: 'Sent', answered: 'Answered', no_response: 'No response', skipped: 'Skipped', failed: 'Failed' };
const INTAKE = { inquiry: 'Inquiry', paperwork_sent: 'Paperwork sent', paperwork_received: 'Paperwork received', consult_scheduled: 'Consult scheduled', ready: 'Ready (awaiting Go)', active: 'Active' };
const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
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
      : ['● Minutes', '— 7-reply average', '○ No response', '┄ Target', '┆ Note'];
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
    h('div', { class: 'muted' }, `${g.response_type === 'yes_no' ? 'Yes/No' : 'Minutes'} · ${g.status} · asks ${owner?.name ?? 'contact'} at ${g.schedule_json.time} on ${g.schedule_json.days.map((d) => DAYS[d]).join(', ')}`),
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

const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Raw-file upload (the API reads the body as the file, name in X-Filename). */
async function upload(path, file) {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-Requested-With': 'totty', 'X-Filename': encodeURIComponent(file.name) },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `${file.name}: upload failed (${res.status})`);
  return data;
}

/** Intake paperwork (SPEC 5.1a step 3): returned form auto-fills the client, documents are attached. */
async function intakeDocsSection({ h, api, handle }, id, reload) {
  const { documents, conflicts } = await api(`/clients/${id}/intake`);
  const result = h('div', { role: 'status' });
  const show = (r) => result.replaceChildren(
    r.filled?.length ? h('p', { class: 'ok-line' }, `Filled from the form: ${r.filled.join(', ')}.`) : '',
    r.status_advanced ? h('p', { class: 'ok-line' }, 'Status set to Paperwork received.') : '',
    ...(r.warnings ?? []).map((w) => h('p', { class: 'warn-line' }, `⚠ ${w}`)));
  const pick = (label, accept, path, multiple) => {
    const input = h('input', { type: 'file', accept, multiple, required: true });
    const msg = h('span', { class: 'error', role: 'alert' });
    const form = h('form', { class: 'inline-form', onsubmit: async (e) => {
      e.preventDefault();
      msg.textContent = '';
      try {
        let last = {};
        for (const f of input.files) { last = await upload(path, f); show(last); }
        await reload(last);
      } catch (ex) { msg.textContent = ex.message; }
    } }, h('label', {}, label, input), h('button', { type: 'submit' }, 'Upload'), msg);
    return form;
  };
  return h('section', {},
    h('h2', {}, 'Intake documents'),
    ...conflicts.map((c) => h('div', { class: 'warn-line' }, `⚠ Not filled — ${c.field}: you entered "${c.entered}", the form says "${c.form}". Your value was kept; edit the client to resolve.`)),
    pick('Returned intake form (.csv or .json)', '.csv,.json', `/clients/${id}/intake/form`, false),
    pick('Other documents (consent, insurance, assessments)', '.pdf,.png,.jpg,.jpeg,.gif,.doc,.docx,.txt', `/clients/${id}/documents`, true),
    result,
    documents.length
      ? h('table', { class: 'compact' }, h('tbody', {}, documents.map((d) => h('tr', {},
          h('td', {}, h('a', { href: `/api/documents/${d.id}` }, d.filename)),
          h('td', {}, d.kind === 'form' ? 'Intake form' : 'Document'),
          h('td', {}, fmtSize(d.size_bytes)),
          h('td', {}, String(d.uploaded_at).slice(0, 10))))))
      : h('p', { class: 'muted' }, 'No intake documents yet.'));
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
    lbl('Answer type', h('select', { name: 'response_type' }, h('option', { value: 'yes_no' }, 'Yes / No'), h('option', { value: 'duration' }, 'Minutes'))),
    lbl('Time', h('input', { name: 'time', type: 'time', value: '18:30', required: true })),
    lbl('Start date', h('input', { name: 'start_date', type: 'date', value: today(), required: true })),
    lbl('Target (% yes or average minutes, optional)', h('input', { name: 'target', type: 'number', min: 0, step: 'any' })),
    h('fieldset', {}, h('legend', {}, 'Days'), DAYS.map((d, i) => h('label', {}, h('input', { name: 'day', type: 'checkbox', value: i, checked: true }), ` ${d}`))),
  ], 'Add goal', async (f) => {
    const days = f.getAll('day').map(Number);
    const body = trimmed(f);
    for (const k of ['day', 'time', 'target']) delete body[k];
    const t = f.get('target');
    if (t) body.target_json = f.get('response_type') === 'yes_no' ? { type: 'percent_yes', threshold: Number(t) } : { type: 'avg_minutes', threshold: Number(t) };
    await post('/goals', { ...body, channel: 'sms', schedule_json: { days, time: f.get('time') } });
  });

  const liveGoals = c.goals.filter((g) => g.status !== 'archived');
  const archivedGoals = c.goals.filter((g) => g.status === 'archived');

  const reinforcementForm = inlineForm(h, [lbl('Preferred reinforcement', h('input', { name: 'name', required: true, placeholder: 'e.g. bubbles' }))],
    'Add', (f) => post('/reinforcements', trimmed(f)));

  const intakeDocs = await intakeDocsSection(ctx, id, async (last) => {
    await reload();
    // Re-rendering clears the result line; keep the outcome of the last upload visible.
    const box = document.querySelector('[role=status]');
    if (box && (last.filled?.length || last.conflicts?.length)) box.append(h('p', { class: 'ok-line' }, `Last upload filled: ${(last.filled ?? []).join(', ') || 'nothing new'}.`));
  }).catch((e) => h('p', { class: 'error' }, e.message));
  const reports = await reportsSection(ctx, id);
  const dash = await api('/dashboard');
  const me = dash.clients.find((x) => x.id === id);
  const prompts = dash.today.filter((p) => p.client_id === id);
  const todaySection = [
    h('h2', {}, 'Today'),
    ...(me?.attention ?? []).map((a) => h('div', { class: 'warn-line' }, `⚠ ${a}`)),
    prompts.length
      ? h('table', { class: 'compact' }, h('tbody', {}, prompts.map((p) => h('tr', {},
          h('td', {}, fmtTime(p.scheduled_for)), h('td', {}, p.title),
          h('td', { class: `s-${p.status}` }, p.status === 'answered' && (p.value_bool != null || p.value_minutes != null)
            ? (p.response_type === 'yes_no' ? (p.value_bool ? 'Yes' : 'No') : `${p.value_minutes} min`)
            : (STATUS[p.status] ?? p.status), p.status === 'deferred' && p.deferred_reason ? ` (${p.deferred_reason.replace('_', ' ')})` : '')))))
      : h('p', { class: 'muted' }, 'Nothing scheduled today.'),
  ];

  const isActive = c.intake_status === 'active';
  const statusSelect = h('select', { 'aria-label': 'Intake status', disabled: isActive, onchange: (e) => {
    api(`/clients/${id}/intake-status`, { method: 'POST', body: { intake_status: e.target.value } }).then(reload, handle);
  } }, Object.entries(INTAKE).filter(([k]) => k !== 'active' || isActive)
    .map(([k, label]) => h('option', { value: k, selected: k === c.intake_status }, label)));
  const intakeSection = h('div', { class: 'intake' },
    h('span', {}, 'Intake: ', h('span', { class: `badge ${isActive ? 'ok' : ''}` }, INTAKE[c.intake_status] ?? c.intake_status), ' '),
    isActive
      ? h('span', { class: 'muted' }, `Active since ${String(c.activated_at).slice(0, 10)}`)
      : [statusSelect, ' ',
        h('button', { type: 'button', disabled: c.intake_status !== 'ready', title: c.intake_status === 'ready' ? '' : 'Set status to "Ready" first', onclick: () => {
          if (!confirm(`Press Go for ${c.first_name} ${c.last_name}? Prompts will start going to the family.`)) return;
          api(`/clients/${id}/go`, { method: 'POST' }).then(reload, handle);
        } }, 'Go'),
        h('p', { class: 'muted' }, 'No prompts are sent until Go is pressed.')]);

  app.replaceChildren(
    h('p', {}, h('a', { href: '#/' }, '← Dashboard')),
    h('h2', {}, `${c.first_name} ${c.last_name}`, ' ', h('a', { href: `#/client/${id}/edit`, class: 'button' }, 'Edit')),
    h('p', { class: 'muted' }, `Admitted ${String(c.admission_date).slice(0, 10)} · ${c.location_name ?? ''} · ${c.timezone}`),
    intakeSection,
    intakeDocs,
    ...todaySection,
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
