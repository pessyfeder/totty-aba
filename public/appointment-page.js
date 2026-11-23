// Appointment pages (opened from the Schedule tab): Initial Consultation, First check-in (Baseline), Weekly check-in.
// One renderer, three configurations. Notes are saved on the appointment record.
import { chartFor } from './charts.js';

const KINDS = {
  initial_consultation: {
    label: 'Initial Consultation',
    intro: 'First session with the family, guided by the Initial Consultation Form.',
    agenda: ['Discuss the goals and agree on the priority goal', 'Choose preferred reinforcements', 'Explain how goal logging works (daily text prompts)', 'Explain what happens after the 7-day baseline'],
    after: ['Send the family the paperwork or follow-ups agreed in the meeting', 'Enter the goals and reinforcements discussed', 'Press Activate on the client page to start the daily prompts'],
    showGoals: false,
  },
  first_checkin: {
    label: 'First check-in (Baseline)',
    intro: 'Review the first 7 days of baseline data with the family.',
    agenda: ['Review the baseline data for each goal', 'Set or confirm goal targets and reinforcement levels', 'Confirm prompt schedules going forward'],
    after: ['Set or update goal targets and prompt schedules', 'Adjust reinforcements if needed', 'The client becomes Active once this appointment has passed; the family books the next check-in (the weekly text carries the booking link)'],
    showGoals: true, range: 'week',
  },
  biweekly_checkin: {
    label: 'Weekly check-in',
    intro: 'Regular progress review.',
    agenda: ['Review progress on each goal', 'Adjust goals or reinforcements; archive mastered goals and add new ones', 'Parent training and questions', 'Consider creating a bi-weekly report'],
    after: ['Update, archive or add goals and reinforcements', 'Create a bi-weekly report if one is due', 'Family books the next check-in (the weekly text carries the booking link)'],
    showGoals: true, range: 'month',
  },
};

const fmtWhen = (a) => {
  const start = new Date(a.starts_at);
  const day = start.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const t = (d) => d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
  return `${day}, ${t(start)}${a.ends_at ? ` – ${t(new Date(a.ends_at))}` : ''}`;
};

/** Per-goal summary and chart for the period under review. */
function goalProgress({ h, api, handle }, g, range) {
  const summary = h('div', { class: 'muted' }, 'Loading…');
  const body = h('div', {});
  api(`/goals/${g.id}/series?range=${range}`).then((d) => {
    const answered = d.points.filter((p) => p.answered).length;
    summary.replaceChildren(`${answered} of ${d.points.length} replies · Trend: `, h('strong', { class: `trend-${d.trend}` }, d.trend.replace(/_/g, ' ')));
    const chart = chartFor(g, d.points, d.annotations);
    body.replaceChildren(chart ?? h('p', { class: 'muted' }, 'No prompts in this period.'));
  }).catch(handle);
  return h('article', { class: 'card goal-card' }, h('h3', {}, g.title), summary, body);
}

export async function renderAppointment({ h, api, app, logoutBtn, handle }, id) {
  const a = await api(`/appointments/${id}`);
  logoutBtn.hidden = false;
  const cfg = KINDS[a.kind] ?? KINDS.biweekly_checkin;
  const who = a.client_id ? `${a.first_name} ${a.last_name}` : 'Unassigned client';
  const liveGoals = a.goals.filter((g) => g.status !== 'archived');

  const saved = h('span', { class: 'muted', role: 'status' });
  const notes = h('textarea', { name: 'notes', rows: 8, 'aria-label': 'Notes from this meeting' }, a.notes ?? '');
  const notesForm = h('form', { class: 'login', onsubmit: async (e) => {
    e.preventDefault();
    saved.className = 'muted';
    try { await api(`/appointments/${id}`, { method: 'PATCH', body: { notes: notes.value } }); saved.textContent = 'Saved.'; }
    catch (ex) { saved.className = 'error'; saved.textContent = ex.message; }
  } }, notes, h('div', {}, h('button', { type: 'submit' }, 'Save notes'), ' ', saved));

  const outcomeSaved = h('span', { class: 'muted', role: 'status' });
  const outcome = h('textarea', { name: 'outcome_note', rows: 4, maxlength: 5000, 'aria-label': 'Outcome note', placeholder: 'What was reviewed, what changed, next steps' }, a.outcome_note ?? '');
  const saveOutcome = (body, okText) => async () => {
    outcomeSaved.className = 'muted';
    try { await api(`/appointments/${id}`, { method: 'PATCH', body: { ...body, outcome_note: outcome.value } }); outcomeSaved.textContent = okText; if (body.status) await renderAppointment({ h, api, app, logoutBtn, handle }, id); }
    catch (ex) { outcomeSaved.className = 'error'; outcomeSaved.textContent = ex.message; }
  };
  const outcomeSection = h('section', {},
    h('h3', {}, 'Outcome'),
    h('p', { class: 'muted' }, 'A short summary of the meeting. Private: never sent by text or email, and not included in reports.'),
    outcome,
    h('div', {}, a.status === 'scheduled'
      ? [h('button', { type: 'button', onclick: saveOutcome({ status: 'held' }, 'Marked held.') }, 'Mark held'), ' ']
      : '',
      a.status === 'held' ? [h('button', { type: 'button', onclick: saveOutcome({}, 'Saved.') }, 'Save outcome note'), ' '] : '',
      outcomeSaved));

  app.replaceChildren(
    h('p', {}, h('a', { href: '#/appointments' }, '← Schedule')),
    h('h2', {}, cfg.label),
    h('p', {}, h('strong', {}, who), a.type && a.type !== 'ongoing meeting' ? ` · ${a.type}` : ''),
    h('p', { class: 'muted' }, fmtWhen(a)),
    h('p', {}, h('span', { class: `badge appt-${a.status}` }, a.status)),
    a.client_id ? h('p', {}, h('a', { href: `#/client/${a.client_id}`, class: 'button' }, 'Open client')) : '',
    h('p', {}, cfg.intro),
    h('p', { class: 'muted' }, 'Meeting purposes follow SPEC 5.7b; Totty has not yet confirmed them.'),
    h('h3', {}, 'What is discussed'),
    h('ul', {}, cfg.agenda.map((x) => h('li', {}, x))),
    h('h3', {}, 'What needs to happen after'),
    h('ul', {}, cfg.after.map((x) => h('li', {}, x))),
    a.client_id && a.kind === 'initial_consultation' ? h('section', {},
      h('h3', {}, 'Goals and reinforcements so far'),
      liveGoals.length ? h('ul', {}, liveGoals.map((g) => h('li', {}, g.title))) : h('p', { class: 'muted' }, 'No goals yet.'),
      a.reinforcements.length ? h('ul', { class: 'chips' }, a.reinforcements.map((r) => h('li', {}, r.name))) : h('p', { class: 'muted' }, 'No reinforcements recorded.')) : '',
    a.client_id && cfg.showGoals ? h('section', {},
      h('h3', {}, a.kind === 'first_checkin' ? 'Baseline data (first 7 days)' : 'Progress'),
      liveGoals.length ? liveGoals.map((g) => goalProgress({ h, api, handle }, g, cfg.range)) : h('p', { class: 'muted' }, 'No goals yet.')) : '',
    a.status === 'cancelled' ? '' : outcomeSection,
    h('h3', {}, 'Notes'),
    notesForm);
}
