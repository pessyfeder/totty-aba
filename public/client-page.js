// Client page: contacts, goals, per-goal charts, notes (SPEC 5.1, 5.2, 5.5, 5.6a).
import { chartFor } from './charts.js';
import { reportsSection } from './reports-page.js';
import { contactForm } from './contacts-page.js';

const RANGES = [['week', '1 week'], ['month', '1 month'], ['3months', '3 months'], ['all', 'All']];
const TREND = { improving: 'Improving', flat: 'Flat', declining: 'Declining', not_enough_data: 'Not enough data yet' };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const STATUS = { scheduled: 'Scheduled', deferred: 'Deferred', sending: 'Sending', sent: 'Sent', answered: 'Answered', no_response: 'No response', skipped: 'Skipped', failed: 'Failed' };
const INTAKE = { inquiry: 'Reached out', paperwork_received: 'Information submitted', baseline: 'Baseline', active: 'Active' };
// What Yisroel should do next at each status (SPEC 5.1a).
const NEXT_STEP = {
  inquiry: 'Reached out: send the email with the link to the profile page for the parents to fill out and submit (review and approve it below).',
  paperwork_received: 'Information submitted: send the initial consultation email with the document explaining what will be discussed (review and approve it below). At the consultation, set the goals and plan, then press Activate.',
  baseline: 'Baseline: prompts are going to the parents. After a week of consistent replies the parent is texted to schedule the first check-in; the client becomes Active after that appointment.',
};
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
/** Heading row with an "Add" button on the right that pops the given form up in a small dialog. */
function addHead(h, title, buttonLabel, form) {
  const dlg = h('dialog', { class: 'form-dialog' }, h('h3', {}, buttonLabel), form,
    h('button', { type: 'button', class: 'link', onclick: () => dlg.close() }, 'Cancel'));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  return h('div', { class: 'tab-head' }, h('h2', { class: 'first' }, title),
    h('button', { type: 'button', onclick: () => dlg.showModal() }, buttonLabel), dlg);
}
const trimmed = (f) => Object.fromEntries([...f.entries()].map(([k, v]) => [k, String(v).trim()]).filter(([, v]) => v !== ''));

function goalCard({ h, api, handle }, g, contacts, reload, mode = 'progress') {
  const progress = mode === 'progress';
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
    lbl('Note on the chart', h('input', { name: 'text', placeholder: 'e.g. new intervention started', required: true, class: 'note-input' })),
  ], 'Add note', async (f) => { await api(`/goals/${g.id}/annotations`, { method: 'POST', body: trimmed(f) }); await draw(); });

  const owner = contacts.find((c) => c.id === g.contact_id);
  const meta = h('div', { class: 'muted' }, `${g.response_type === 'yes_no' ? 'Yes/No' : 'Minutes'} · ${g.status} · asks ${owner?.name ?? 'contact'} at ${g.schedule_json.time} on ${g.schedule_json.days.map((d) => DAYS[d]).join(', ')}`);
  const stamp = (iso) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  const history = h('div', { class: 'muted' }, `Created ${stamp(g.created_at)}`,
    ...(g.status_changes ?? []).flatMap((c) => [h('br'), `${c.from_status} → ${c.to_status} on ${stamp(c.change_made_datetime)}`]));
  const card = progress
    ? h('article', { class: 'card goal-card' }, h('h3', {}, `${g.number}. ${g.title}`), meta, history, summary, rangeBar, body, g.status === 'archived' ? '' : note)
    : goalListCard();
  function goalListCard() {
    if (g.status === 'archived') {
      return h('article', { class: 'card goal-card' }, h('h3', {}, `${g.number}. ${g.title}`, ' ', h('span', { class: 'badge' }, g.status)), meta, history,
        h('p', { class: 'muted' }, 'Archived: no more prompts. History is kept.'));
    }
    // The pencil reveals the edit panel in place; Pause/Resume and Archive live there.
    const panel = h('div', { hidden: true },
      h('button', { type: 'button', class: 'link', onclick: () => {
        const next = g.status === 'paused' ? 'active' : 'paused';
        api(`/goals/${g.id}`, { method: 'PATCH', body: { status: next } }).then(reload, handle);
      } }, g.status === 'paused' ? 'Resume prompts' : 'Pause prompts'),
      h('button', { type: 'button', class: 'link', onclick: () => {
        if (!confirm(`Archive "${g.title}"? Prompts stop for good and the goal can't be edited or restored. Its history is kept.`)) return;
        api(`/goals/${g.id}`, { method: 'PATCH', body: { status: 'archived' } }).then(reload, handle);
      } }, 'Archive goal'));
    const pencil = h('button', { type: 'button', class: 'acc-act', title: 'Edit goal', 'aria-label': `Edit goal: ${g.title}`, onclick: () => { panel.hidden = !panel.hidden; } });
    pencil.innerHTML = ICON.edit;
    return h('article', { class: 'card goal-card' },
      h('h3', {}, `${g.number}. ${g.title}`, ' ', h('span', { class: `badge ${g.status === 'active' ? 'ok' : ''}` }, g.status), ' ', pencil), meta, history, panel);
  }
  if (progress) draw().catch(handle);
  return card;
}

/** Signed consent from the online intake form (SPEC 5.1a step 3): who signed and when. */
function consentSection({ h }, c) {
  const when = c.consent_signed_at ? new Date(c.consent_signed_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '';
  return {
    badge: c.consent_signed_at ? 'Signed' : 'None',
    cls: c.consent_signed_at ? 'ok' : '',
    node: c.consent_signed_at
      ? h('p', {}, `Consents signed by ${c.consent_signed_by || 'a parent'} on ${when}, on the online intake form.`)
      : h('p', { class: 'muted' }, 'No signed consent on file.'),
  };
}

/** Initial consultation email (SPEC 5.7b): Totty reads the exact text and approves or declines the first send. */
const consultEmailSection = (ctx, id, reload) => emailSection(ctx, id, reload, {
  path: 'consult-email', title: 'Initial consultation email', name: 'consultation email', hint: 'Information submitted. Review this email to the family and approve it to send.' });

/** First reply to a new inquiry (SPEC 5.1a): carries the client information page link. */
const inquiryEmailSection = (ctx, id, reload) => emailSection(ctx, id, reload, {
  path: 'inquiry-email', title: 'Profile page email', name: 'first reply email', hint: 'Reached out. Review this email to the family, with the link to the profile page for them to fill out, and approve it to send.' });

async function emailSection({ h, api, handle }, id, reload, { path, title, name, hint }) {
  const e = await api(`/clients/${id}/${path}`);
  const cap = name[0].toUpperCase() + name.slice(1);
  if (!e) return null;
  if (e.status === 'cancelled') return { badge: 'Declined', node: h('p', { class: 'muted' }, `${cap}: not sent (you declined it).`) };
  const act = (p) => api(`/clients/${id}/${path}/${p}`, { method: 'POST' }).then(reload, handle);
  if (e.status === 'sent') return { badge: 'Sent', cls: 'ok', node: h('p', { class: 'ok-line' }, `✉ ${cap} sent to ${e.to} on ${String(e.sent_at).slice(0, 10)}.`) };
  if (e.status === 'failed') return { badge: 'Failed', cls: 'bad', node: h('p', { class: 'warn-line' }, `⚠ The ${name} could not be sent: ${e.last_error ?? 'unknown error'}`) };
  const approved = e.status !== 'pending_approval';
  const node = h('div', {},
    approved
      ? h('p', { class: 'ok-line' }, '✉ Approved. It goes out as soon as it can (not during Shabbos or Yom Tov).')
      : h('p', { class: 'muted' }, hint),
    ...e.problems.map((p) => h('p', { class: 'warn-line' }, `⚠ ${p}`)),
    e.last_error ? h('p', { class: 'warn-line' }, `⚠ Last attempt failed: ${e.last_error}`) : '',
    e.text ? h('div', { class: 'card' }, h('div', { class: 'muted' }, `To: ${e.to}`), h('strong', {}, e.subject), h('pre', { style: 'white-space: pre-wrap; font: inherit' }, e.text)) : '',
    h('button', { type: 'button', disabled: approved || e.problems.length > 0, onclick: () => act('approve') }, 'Approve and send'), ' ',
    h('button', { type: 'button', class: 'link', onclick: () => { if (confirm(`Don't send the ${name}?`)) act('cancel'); } }, approved ? 'Cancel' : 'Decline'));
  return { badge: approved ? 'Approved' : 'Needs approval', cls: approved ? 'ok' : 'bad', node };
}

const ICON = {
  edit: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  add: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
};
const openChips = new Set(); // which chips are expanded; survives the page re-render after a save

/** Compact expandable chip: title + short summary, optional pencil/plus on the far right. */
function chip(h, key, title, summary, body, { badge, cls, action } = {}) {
  const d = h('details', { class: 'acc' });
  d.open = openChips.has(key);
  d.addEventListener('toggle', () => { d.open ? openChips.add(key) : openChips.delete(key); });
  const act = action && (() => {
    const el = h(action.href ? 'a' : 'button', { class: 'acc-act', type: action.href ? undefined : 'button', href: action.href, title: action.label, 'aria-label': action.label,
      onclick: action.href ? undefined : (e) => { e.preventDefault(); e.stopPropagation(); d.open = true; action.onclick?.(); } });
    el.innerHTML = ICON[action.icon];
    return el;
  })();
  d.append(h('summary', {}, h('span', { class: 'acc-title' }, title), summary ? h('span', { class: 'acc-sum' }, summary) : '',
    badge ? h('span', { class: `badge ${cls ?? ''}` }, badge) : '', act ?? ''), h('div', { class: 'acc-body' }, body));
  return d;
}

/** Body = read-only view + a hidden edit panel; the chip's pencil reveals the panel in place (no page change). */
function editable(h, view, editPanel) {
  editPanel.hidden = true;
  const box = h('div', {}, view, editPanel);
  return { box, toggle: () => { editPanel.hidden = !editPanel.hidden; view.hidden = !editPanel.hidden; } };
}

const TABS = [['profile', 'Profile'], ['goals', 'Goals'], ['progress', 'Progress'], ['appointments', 'Appointments']];

export async function renderClient(ctx, id, tab = 'profile') {
  const { h, api, app, logoutBtn, handle } = ctx;
  const c = await api(`/clients/${id}`);
  logoutBtn.hidden = false;
  const lbl = (text, input) => h('label', {}, text, input);
  const reload = () => renderClient(ctx, id, tab).catch(handle);
  const post = (path, body) => api(`/clients/${id}${path}`, { method: 'POST', body }).then(reload);

  const goalForm = inlineForm(h, [
    lbl('Goal', h('input', { name: 'title', required: true, placeholder: 'e.g. Used words to ask for help' })),
    lbl('Ask', h('select', { name: 'contact_id', required: true }, c.contacts.map((p) => h('option', { value: p.id }, p.relationship ? `${p.name} (${p.relationship})` : p.name)))),
    lbl('Answer type', h('select', { name: 'response_type' }, h('option', { value: 'yes_no' }, 'Yes / No'), h('option', { value: 'duration' }, 'Minutes'))),
    lbl('Time', h('input', { name: 'time', type: 'time', value: '18:30', required: true })),
    lbl('Start date', h('input', { name: 'start_date', type: 'date', value: today(), required: true })),
    h('div', { class: 'days-field' }, 'Days', h('details', { class: 'days-pick' }, h('summary', {}, 'Select days'), h('div', { class: 'days-list' }, DAYS.map((d, i) => h('label', { class: 'day-opt' }, h('input', { name: 'day', type: 'checkbox', value: i, checked: true }), ` ${d}`))))),
    lbl('Target (% yes or average minutes, optional)', h('input', { name: 'target', type: 'number', min: 0, step: 'any' })),
  ], 'Add goal', async (f) => {
    const days = f.getAll('day').map(Number);
    const body = trimmed(f);
    for (const k of ['day', 'time', 'target']) delete body[k];
    const t = f.get('target');
    if (t) body.target_json = f.get('response_type') === 'yes_no' ? { type: 'percent_yes', threshold: Number(t) } : { type: 'avg_minutes', threshold: Number(t) };
    await post('/goals', { ...body, channel: 'sms', schedule_json: { days, time: f.get('time') } });
  });

  // Goal numbers follow creation order across all goals (archived ones keep theirs).
  c.goals.forEach((g, i) => { g.number = i + 1; });
  const liveGoals = c.goals.filter((g) => g.status !== 'archived');
  const archivedGoals = c.goals.filter((g) => g.status === 'archived');

  const REINFORCERS = ['Bubbles', 'iPad time', 'Gummy bears', 'Stickers', 'Tickets / tokens', 'Tickling', 'Music', 'Swing', 'Favorite toy', 'Playground time', 'Videos', 'Snack', 'High five', 'Praise'];
  const have = new Set(c.reinforcements.map((i) => i.name.toLowerCase()));
  const reinforcementPick = h('select', { 'aria-label': 'Add preferred reinforcement', hidden: true, onchange: (e) => { if (e.target.value) post('/reinforcements', { name: e.target.value }).catch(handle); } },
    h('option', { value: '' }, 'Choose a reinforcement…'), REINFORCERS.filter((r) => !have.has(r.toLowerCase())).map((r) => h('option', { value: r }, r)));

  const consent = consentSection(ctx, c);
  const consultEmail = await consultEmailSection(ctx, id, reload).catch((e) => ({ badge: 'Error', cls: 'bad', node: h('p', { class: 'error' }, e.message) }));
  const inquiryEmail = await inquiryEmailSection(ctx, id, reload).catch((e) => ({ badge: 'Error', cls: 'bad', node: h('p', { class: 'error' }, e.message) }));
  const reports = await reportsSection(ctx, id);
  const responseLog = await responseLogSection(ctx, id);
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
  const isArchived = c.status === 'archived';
  const statusSelect = h('select', { 'aria-label': 'Change status', onchange: (e) => {
    api(`/clients/${id}/intake-status`, { method: 'POST', body: { intake_status: e.target.value } }).then(reload, handle);
  } }, Object.entries(INTAKE)
    .map(([k, label]) => h('option', { value: k, selected: k === c.intake_status }, label)));
  const archiveBtn = h('button', { type: 'button', onclick: () => {
        if (!isArchived && !confirm(`Archive ${c.first_name} ${c.last_name}? Prompts stop and they move to Archived. You can restore them any time.`)) return;
        api(`/clients/${id}/archive`, { method: 'POST', body: { restore: isArchived } }).then(() => { location.hash = '#/clients'; }, handle);
      } }, isArchived ? 'Restore' : 'Archive');
  const deleteBtn = h('button', { type: 'button', class: 'danger', onclick: () => {
        const name = `${c.first_name} ${c.last_name}`;
        if (!confirm(`⚠️ WARNING: PERMANENT DELETION ⚠️\n\nYou are about to permanently delete ${name}.\n\nEVERYTHING will be erased forever: contacts, goals, responses, appointments, progress and documents. There is NO undo and NO way to recover this data.\n\nIf you just want them out of the way, use "Archive client" instead — it keeps everything.\n\nPress OK only if you are absolutely sure.`)) return;
        const expected = `Delete ${name}`;
        const typed = prompt(`To confirm, type exactly:\n\n${expected}`);
        if (typed === null) return;
        if (typed.trim() !== expected) { alert('Text did not match. Nothing was deleted.'); return; }
        if (!confirm(`Final confirmation: permanently delete ${name}? This cannot be undone.`)) return;
        api(`/clients/${id}`, { method: 'DELETE' }).then(() => { location.hash = '#/clients'; }, handle);
      } }, 'Delete');
  const intakeSection = h('div', { class: 'intake' },
    h('div', {}, 'Change status: ', statusSelect),
    isActive ? '' : [
      c.intake_status === 'paperwork_received'
        ? h('button', { type: 'button', onclick: () => {
          if (!confirm(`Activate ${c.first_name} ${c.last_name}? Prompts will start going to the family.`)) return;
          api(`/clients/${id}/intake-status`, { method: 'POST', body: { intake_status: 'active' } }).then(reload, handle);
        } }, 'Activate') : '',
      h('p', { class: 'warn-line' }, NEXT_STEP[c.intake_status] ?? ''),
      h('p', { class: 'muted' }, 'No prompts are sent until baseline starts.')]);
  intakeSection.hidden = isActive;
  const editStatusBtn = h('button', { type: 'button', onclick: () => { intakeSection.hidden = !intakeSection.hidden; } }, 'Edit status');

  const APPT = { to_be_scheduled: 'To be scheduled', scheduled: 'Scheduled', missed: 'Missed', completed: 'Completed', cancelled: 'Cancelled' };
  const apptWhen = (a) => (a.starts_at ? new Date(a.starts_at).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'No date yet');
  const apptAct = (a, body) => api(`/appointments/${a.id}`, { method: 'PATCH', body }).then(reload, handle);
  const localInput = (iso) => { const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  const apptRow = (a) => {
    const needsOutcome = a.status === 'scheduled' && new Date(a.starts_at) < new Date();
    const when = h('input', { type: 'datetime-local', 'aria-label': 'Date and time', value: a.starts_at ? localInput(a.starts_at) : '' });
    const setTime = h('button', { type: 'button', onclick: () => { if (when.value) apptAct(a, { status: 'scheduled', starts_at: new Date(when.value).toISOString() }); } }, a.status === 'to_be_scheduled' ? 'Set time' : 'Reschedule');
    const mark = (label, status) => h('button', { type: 'button', class: 'link', onclick: () => apptAct(a, { status }) }, label);
    return h('tr', {},
      h('td', {}, apptWhen(a), needsOutcome ? h('div', { class: 'warn-line' }, 'Did it happen?') : ''),
      h('td', {}, a.type === 'consultation' ? 'Consultation' : a.type === 'check-in' ? 'Check-in' : a.type),
      h('td', {}, h('span', { class: `badge appt-${a.status}` }, APPT[a.status] ?? a.status)),
      h('td', {}, a.status === 'cancelled' ? '' : [
        a.status === 'completed' || a.status === 'missed' ? '' : [when, ' ', setTime, ' '],
        a.status === 'scheduled' ? [mark('Completed', 'completed'), mark('Missed', 'missed')] : '',
        a.status === 'completed' || a.status === 'missed' ? mark(a.status === 'missed' ? 'Mark completed' : 'Mark missed', a.status === 'missed' ? 'completed' : 'missed') : '']),
      h('td', {}, a.id ? h('a', { href: `#/appointment/${a.id}` }, 'Notes') : ''));
  };
  const addAppt = inlineForm(h, [
    lbl('Type', h('select', { name: 'type' }, h('option', { value: 'check-in' }, 'Check-in'), h('option', { value: 'consultation' }, 'Consultation'))),
    lbl('Date and time', h('input', { name: 'starts_at', type: 'datetime-local', required: true })),
  ], 'Add appointment', async (f) => {
    await post('/appointments', { type: f.get('type'), starts_at: new Date(f.get('starts_at')).toISOString() });
  });
  const groupOrder = ['to_be_scheduled', 'scheduled', 'missed', 'completed', 'cancelled'];
  const apptTab = [
    addHead(h, 'Appointments', 'Add appointment', addAppt),
    h('p', { class: 'muted' }, 'Appointments booked on the calendar appear here automatically. Mark each as completed or missed afterwards.'),
    h('div', { class: 'appt-counts' }, groupOrder.slice(1, 4).map((s) => h('span', { class: `badge appt-${s}` }, `${APPT[s]}: ${c.appointments.filter((a) => a.status === s).length}`))),
    ...groupOrder.map((s) => {
      const list = c.appointments.filter((a) => a.status === s);
      return list.length ? h('section', {}, h('h3', {}, APPT[s]), h('table', { class: 'compact' }, h('tbody', {}, list.map(apptRow)))) : '';
    }),
    c.appointments.length ? '' : h('p', { class: 'muted' }, 'No appointments yet.'),
  ];
  const noPhone = c.contacts.filter((p) => !p.consent_given_at).length;
  const contactsView = c.contacts.length
    ? h('div', { class: 'acc-list' }, c.contacts.map((p, idx) => h('div', { class: 'acc-list', style: idx ? 'margin-top:14px' : '' },
      ...[
        ['Name', p.name],
        ['Relationship to client', p.relationship],
        ['Phone', p.phone],
        ['Email', p.email],
        ['Preferred contact method', p.preferred_channel === 'call' ? 'Call' : 'Text'],
        ['Consent', p.consent_given_at ? 'Recorded' : 'Not recorded'],
        ['Status', p.status.charAt(0).toUpperCase() + p.status.slice(1)],
      ].filter(([, v]) => v).map(([k, v]) => h('div', { class: 'acc-row' }, h('strong', {}, `${k}: `), String(v))))))
    : h('p', { class: 'muted' }, 'No contacts yet.');
  const reinfBody = h('div', {},
    c.reinforcements.length ? h('div', { class: 'acc-list' }, c.reinforcements.map((i) => h('div', { class: 'acc-row' }, i.name))) : h('p', { class: 'muted' }, 'None recorded'),
    reinforcementPick);
  const day10 = (v) => (v ? String(v).slice(0, 10) : '');
  const ageOf = (v) => {
    if (!v) return '';
    const [y, m, d] = String(v).slice(0, 10).split('-').map(Number);
    const t = new Date();
    const a = t.getFullYear() - y - (t.getMonth() + 1 < m || (t.getMonth() + 1 === m && t.getDate() < d) ? 1 : 0);
    return a >= 0 ? a : '';
  };
  const detailsView = h('div', { class: 'acc-list' }, [
    ['Name', `${c.first_name} ${c.last_name}`],
    ['Date of birth', day10(c.dob)],
    ['Admission date', day10(c.admission_date)],
    ['Age', ageOf(c.dob)],
    ['Gender', c.gender],
    ['Location', [c.street_address, c.city, [c.state, c.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ') || c.location_name],
    ['Candle lighting', c.candle_lighting_minutes != null ? `${c.candle_lighting_minutes} min before sunset` : ''],
    ['Notes', c.notes],
  ].filter(([, v]) => v != null && v !== '').map(([k, v]) => h('div', { class: 'acc-row' }, h('strong', {}, `${k}: `), String(v))));
  const detailsMsg = h('p', { class: 'error', role: 'alert' });
  const dv = (k) => (c[k] == null ? '' : String(c[k]).slice(0, k === 'dob' || k === 'admission_date' ? 10 : undefined));
  const dfield = (label, name, attrs = {}) => h('label', {}, label, h('input', { name, value: dv(name), ...attrs }));
  const DETAIL_OPTIONAL = ['gender', 'dob', 'location_name', 'street_address', 'city', 'state', 'zip', 'candle_lighting_minutes', 'notes'];
  const detailsForm = h('form', { class: 'contact-form', onsubmit: async (e) => {
    e.preventDefault();
    detailsMsg.textContent = '';
    const f = new FormData(detailsForm);
    const body = {};
    for (const [k, val] of f.entries()) {
      const t = String(val).trim();
      if (t !== '') body[k] = t;
      else if (DETAIL_OPTIONAL.includes(k)) body[k] = null;
    }
    body.in_israel = f.get('in_israel') === 'on';
    try { await api(`/clients/${id}`, { method: 'PATCH', body }); await reload(); } catch (ex) { detailsMsg.textContent = ex.message; }
  } },
    dfield('First name', 'first_name', { required: true }),
    dfield('Last name', 'last_name', { required: true }),
    dfield('Gender', 'gender'),
    dfield('Date of birth', 'dob', { type: 'date' }),
    dfield('Admission date', 'admission_date', { type: 'date', required: true }),
    dfield('Street address', 'street_address', { placeholder: 'e.g. 123 Main St' }),
    dfield('City', 'city'),
    dfield('ZIP', 'zip', { inputmode: 'numeric', maxlength: 10 }),
    h('label', {}, 'State', h('select', { name: 'state' }, h('option', { value: '' }, '—'), ...['NY', 'NJ'].map((s) => h('option', { value: s, selected: c.state === s }, s)))),
    dfield('Location name', 'location_name', { placeholder: 'e.g. Brooklyn, NY' }),
    dfield('Latitude', 'latitude', { type: 'number', step: 'any', min: -90, max: 90, required: true }),
    dfield('Longitude', 'longitude', { type: 'number', step: 'any', min: -180, max: 180, required: true }),
    dfield('Timezone', 'timezone', { required: true }),
    h('label', {}, h('input', { name: 'in_israel', type: 'checkbox', checked: Boolean(c.in_israel) }), ' Lives in Israel (Yom Tov observance)'),
    dfield('Candle lighting (minutes before sunset)', 'candle_lighting_minutes', { type: 'number', min: 0, placeholder: 'default 18' }),
    h('label', {}, 'Notes', h('textarea', { name: 'notes', rows: 3 }, c.notes ?? '')),
    h('button', { type: 'submit' }, 'Save changes'), detailsMsg);
  const detailsEd = editable(h, detailsView, detailsForm);
  const detailsBody = detailsEd.box;

  const contactsEdit = h('div', {},
    h('p', { class: 'muted' }, 'Pausing or ending a contact stops all prompts to that person.'),
    ...c.contacts.map((p) => h('details', { class: 'card goal-card' }, h('summary', {}, `${p.name}${p.relationship ? ` (${p.relationship})` : ''}`), contactForm({ h, api }, id, p, reload))),
    h('h3', {}, 'Add a contact'), contactForm({ h, api }, id, null, reload));
  const contactsEd = editable(h, contactsView, contactsEdit);
  const statusLabel = isArchived ? 'Archived' : (INTAKE[c.intake_status] ?? c.intake_status);
  const statusText = isActive && !isArchived && c.activated_at ? `Active since ${String(c.activated_at).slice(0, 10)}` : statusLabel;
  const statusChip = h('div', { class: 'acc acc-flat' },
    h('div', { class: 'acc-flat-row' }, h('span', { class: 'acc-title' }, 'Client status'), h('span', { class: 'acc-sum' }, statusText),
      h('span', { class: 'acc-right' }, editStatusBtn, archiveBtn, deleteBtn)),
    h('div', { class: 'acc-flat-panel' }, intakeSection));
  const profileTab = [
    h('div', { class: 'acc-stack' },
      statusChip,
      chip(h, 'details', 'Client details', c.state ?? '', detailsBody, { action: { icon: 'edit', label: 'Edit client details', onclick: detailsEd.toggle } }),
      inquiryEmail ? chip(h, 'inquiry', 'Profile page email', '', inquiryEmail.node, inquiryEmail) : '',
      consultEmail ? chip(h, 'consult', 'Initial consultation email', '', consultEmail.node, consultEmail) : '',
      chip(h, 'contacts', 'Contact info', `${c.contacts.length} ${c.contacts.length === 1 ? 'contact' : 'contacts'}${noPhone ? ` · ${noPhone} without consent` : ''}`, contactsEd.box, { action: { icon: 'edit', label: 'Edit contacts', onclick: contactsEd.toggle } }),
      chip(h, 'reinf', 'Preferred reinforcements', c.reinforcements.map((i) => i.name).join(', '), reinfBody,
        { action: { icon: 'add', label: 'Add reinforcement', onclick: () => { reinforcementPick.hidden = false; reinforcementPick.focus(); } } }),
      chip(h, 'consent', 'Signed consent', '', consent.node, { badge: consent.badge, cls: consent.cls })),
  ];
  const goalsTab = [
    c.contacts.length ? addHead(h, 'Goals', 'Add goal', goalForm) : h('h2', { class: 'first' }, 'Goals'),
    ...(liveGoals.length ? liveGoals.map((g) => goalCard(ctx, g, c.contacts, reload, 'goals')) : [h('p', { class: 'muted' }, 'No goals yet.')]),
    c.contacts.length ? '' : h('p', { class: 'muted' }, 'Add a contact (Profile tab) before adding a goal.'),
    archivedGoals.length ? h('details', {}, h('summary', {}, `Archived goals (${archivedGoals.length})`), ...archivedGoals.map((g) => goalCard(ctx, g, c.contacts, reload, 'goals'))) : '',
  ];
  const progressTab = [
    ...todaySection,
    h('h2', {}, 'Progress'),
    ...(liveGoals.length ? liveGoals.map((g) => goalCard(ctx, g, c.contacts, reload, 'progress')) : [h('p', { class: 'muted' }, 'No goals to chart yet.')]),
    ...responseLog,
    reports,
    archivedGoals.length ? h('details', {}, h('summary', {}, `Archived goals (${archivedGoals.length})`), ...archivedGoals.map((g) => goalCard(ctx, g, c.contacts, reload, 'progress'))) : '',
  ];

  // Sidebar: every client, the current one highlighted; searchable.
  const everyone = [...dash.clients.filter((x) => x.id !== id), { id, first_name: c.first_name, last_name: c.last_name, attention: me?.attention ?? [] }]
    .sort((a, b) => `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`));
  const initials = (x) => `${x.first_name[0] ?? ''}${x.last_name[0] ?? ''}`.toUpperCase();
  const TAB_ICONS = { profile: '👤', goals: '🎯', progress: '📈', appointments: '📅' };
  const sideItems = everyone.map((x) => h('div', { class: `side-item${x.id === id ? ' current' : ''}`, 'data-name': `${x.first_name} ${x.last_name}`.toLowerCase() },
    h('a', { class: 'side-link', href: `#/client/${x.id}/${tab}`, 'aria-current': x.id === id ? 'page' : false },
      h('span', { class: 'avatar' }, initials(x)), h('span', { class: 'side-name' }, `${x.first_name} ${x.last_name}`), x.attention.length ? h('span', { class: 'side-attn', title: x.attention.join('; ') }, '⚠') : ''),
    h('span', { class: 'side-tabs' }, TABS.map(([k, label]) =>
      h('a', { href: `#/client/${x.id}/${k}`, class: `side-tab${x.id === id && k === tab ? ' current' : ''}`, title: label, 'aria-label': `${x.first_name} ${x.last_name}: ${label}` }, TAB_ICONS[k])))));
  const search = h('input', { type: 'search', placeholder: 'Search clients', 'aria-label': 'Search clients', oninput: () => {
    const q = search.value.trim().toLowerCase();
    for (const a of sideItems) a.hidden = q !== '' && !a.dataset.name.includes(q);
  } });
  const sidebar = h('aside', { class: 'sidebar' },
    h('div', { class: 'side-head' }, 'Clients ', h('span', { class: 'count' }, String(everyone.length))), search, h('nav', { class: 'side-list', 'aria-label': 'Clients' }, sideItems));
  const tabs = h('nav', { class: 'tabs', 'aria-label': 'Client sections' }, TABS.map(([k, label]) =>
    h('a', { href: `#/client/${id}/${k}`, class: `tab${k === tab ? ' current' : ''}`, 'aria-current': k === tab ? 'page' : false }, label)));

  app.className = 'wide';
  app.replaceChildren(h('div', { class: 'client-layout' }, sidebar,
    h('section', { class: 'client-main' },
      h('div', { class: 'client-head' },
        h('a', { href: '#/clients', class: 'back', 'aria-label': 'Back to all clients' }, '‹'),
        h('h2', {}, `${c.first_name} ${c.last_name}`)),
      tabs,
      h('div', { class: 'tab-body' }, ...(tab === 'goals' ? goalsTab : tab === 'progress' ? progressTab : tab === 'appointments' ? apptTab : profileTab)))));
}

const EVENT_LABEL = { prompt: 'Question sent', followup: 'Follow-up sent (no reply yet)', reprompt: 'Asked to resend (reply unreadable)', unreadable: 'Parent replied, but it could not be read', reply: 'Parent replied' };
const fmtStamp = (iso) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const fmtWait = (min) => (min < 60 ? `${min} min` : min < 1440 ? `${Math.round(min / 6) / 10} hr` : `${Math.round(min / 144) / 10} days`);

/** Response log: when each question went out, every follow-up/re-prompt, and when (or whether) the parent answered. */
async function responseLogSection({ h, api, handle }, clientId) {
  let range = 'month';
  const box = h('div', {});
  const rangeBar = h('div', { class: 'range', role: 'group', 'aria-label': 'Response log range' });
  const outcome = (e) => {
    if (e.replied_at) {
      const last = e.events.filter((x) => x.kind === 'reply').at(-1);
      const val = last.value_bool != null ? (last.value_bool ? 'Yes' : 'No') : last.value_minutes != null ? `${last.value_minutes} min` : '';
      return [h('span', { class: 'badge ok' }, 'Replied'), ` ${val}${last.source === 'manual' ? ' (entered manually)' : ''}`];
    }
    if (e.status === 'no_response') return [h('span', { class: 'badge bad' }, 'No response')];
    return [h('span', { class: 'badge' }, STATUS[e.status] ?? e.status)];
  };
  async function draw() {
    for (const b of rangeBar.children) b.setAttribute('aria-pressed', String(b.dataset.r === range));
    const d = await api(`/clients/${clientId}/response-log?range=${range}`);
    const s = d.summary;
    box.replaceChildren(
      h('p', { class: 'muted' }, `${s.total} questions · ${s.answered} answered · ${s.no_response} no response · ${s.needed_followup} needed a follow-up · ${s.needed_reprompt} needed a re-prompt`),
      d.entries.length ? h('div', {}, d.entries.map((e) => h('details', { class: 'log-entry' },
        h('summary', {}, h('strong', {}, e.goal_title), ` · ${e.sent_at ? fmtStamp(e.sent_at) : e.date} · `, ...outcome(e),
          e.replied_at && e.reply_minutes != null ? h('span', { class: 'muted' }, ` · answered after ${fmtWait(e.reply_minutes)}`) : '',
          e.followups ? h('span', { class: 'badge' }, `${e.followups} follow-up${e.followups > 1 ? 's' : ''}`) : '',
          e.reprompts ? h('span', { class: 'badge' }, `${e.reprompts} re-prompt${e.reprompts > 1 ? 's' : ''}`) : ''),
        h('ul', { class: 'log-events' }, e.events.length
          ? e.events.map((ev) => h('li', {}, h('time', {}, fmtStamp(ev.at)), ' — ', EVENT_LABEL[ev.kind] ?? ev.kind,
              ev.kind === 'reply' && ev.value_bool != null ? `: ${ev.value_bool ? 'Yes' : 'No'}` : '',
              ev.kind === 'reply' && ev.value_minutes != null ? `: ${ev.value_minutes} min` : '',
              ev.kind === 'reply' && ev.source === 'manual' ? ' (entered by you)' : '',
              ev.kind === 'unreadable' && ev.text ? `: "${ev.text}"` : ''))
          : [h('li', { class: 'muted' }, 'Nothing was sent.')],
          e.status === 'no_response' && !e.replied_at ? h('li', { class: 'muted' }, 'Day ended with no reply from the parent.') : ''))))
        : h('p', { class: 'muted' }, 'No questions sent in this range yet.'));
  }
  for (const [r, label] of RANGES) rangeBar.append(h('button', { type: 'button', 'data-r': r, onclick: () => { range = r; draw().catch(handle); } }, label));
  await draw().catch(handle);
  return [h('h2', {}, 'Parent response log'), rangeBar, box];
}
