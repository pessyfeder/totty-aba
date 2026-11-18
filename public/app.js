// Dashboard UI (SPEC 5.7). DOM is built with textContent only: parent replies are untrusted text.
import { renderClient as renderClientPage } from './client-page.js';
import { renderContacts } from './contacts-page.js';
import { renderReport } from './reports-page.js';
import { renderSettings } from './settings-page.js';
import { renderAppointment } from './appointment-page.js';
import { renderInfoPage } from './info-page.js';
const app = document.getElementById('app');
const logoutBtn = document.getElementById('logout');

function h(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid !== false) node.append(kid instanceof Node ? kid : document.createTextNode(kid ?? ''));
  return node;
}

class Locked extends Error {
  constructor(body) { super('locked'); this.body = body; }
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'totty' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => ({}));
  if (res.status === 423) throw new Locked(data);
  if (res.status === 401 && path !== '/login') { renderLogin(); throw new Error('login'); }
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data;
}

const fmtDateTime = (iso) => new Date(iso).toLocaleString([], { weekday: 'long', hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' });

let showingLocked = false;

function renderLocked({ kind, reopensAt }) {
  showingLocked = true;
  logoutBtn.hidden = true;
  app.replaceChildren(h('section', { class: 'locked' },
    h('h2', {}, kind === 'yom_tov' ? 'Yom Tov' : 'Shabbos'),
    h('p', {}, 'The app is closed and nothing is sent. Parent replies are still recorded.'),
    h('p', {}, `Reopens ${fmtDateTime(reopensAt)}.`)));
}

function renderLogin(message = '') {
  logoutBtn.hidden = true;
  const err = h('p', { class: 'error', role: 'alert' }, message);
  const form = h('form', { class: 'login', onsubmit: async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    try {
      await api('/login', { method: 'POST', body: { email: f.get('email'), password: f.get('password') } });
      boot();
    } catch (ex) { err.textContent = ex.message; }
  } },
    h('label', {}, 'Email', h('input', { name: 'email', type: 'email', autocomplete: 'username', required: true })),
    h('label', {}, 'Password', h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true })),
    h('button', { type: 'submit' }, 'Log in'), err);
  app.replaceChildren(form);
}

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Builds a 24x24 stroke icon from SVG path data (static strings only). */
function icon(...paths) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}
const ICONS = {
  clients: () => icon('M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20', 'M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z', 'M20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35', 'M14.5 4.2a3.5 3.5 0 0 1 0 6.6'),
  appointments: () => icon('M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z', 'M4 10h16', 'M8 3v4', 'M16 3v4'),
  settings: () => icon('M4 7h9', 'M17 7h3', 'M15 5v4', 'M4 17h3', 'M11 17h9', 'M9 15v4', 'M4 12h16'),
};

/** Dashboard home: three big options under a "Dashboard" heading. */
async function renderDashboard() {
  const d = await api('/dashboard');
  logoutBtn.hidden = false;
  const sh = d.shabbos;
  const option = (href, key, title, text) => h('a', { href, class: 'option' },
    h('span', { class: 'option-icon' }, ICONS[key]()), h('span', { class: 'option-title' }, title), h('span', { class: 'option-text' }, text));
  const n = d.attention.length;
  app.replaceChildren(...[
    sh && sh.active && h('div', { class: 'banner' }, `Shabbos window in effect until ${fmtDateTime(sh.end)}.`),
    h('h2', { class: 'options-heading' }, 'Dashboard'),
    h('div', { class: 'options' },
      option('#/clients', 'clients', 'Clients', n ? `${n} need${n === 1 ? 's' : ''} attention. View and manage your clients.` : 'View and manage your clients.'),
      option('#/appointments', 'appointments', 'Schedule', 'View upcoming scheduled appointments.'),
      option('#/settings', 'settings', 'Settings', 'Booking links and check-in text.')),
  ].filter(Boolean));
}

async function renderClients() {
  const d = await api('/dashboard');
  logoutBtn.hidden = false;
  app.replaceChildren(...[
    h('div', { class: 'stats' },
      h('h2', {}, 'Clients'),
      h('span', { class: 'spacer' })),
    h('div', { class: 'chip-bar' },
      h('a', { href: '#/archived', class: 'chip chip-archived' }, 'View Archived')),
    ...(d.emailsToApprove ?? []).map((c) => h('div', { class: 'warn-line' }, `✉ ${c.kind === 'inquiry' ? 'Profile page email' : 'Initial consultation email'} for ${c.first_name} ${c.last_name} is waiting for your approval. `,
      h('a', { href: `#/client/${c.id}` }, 'Review'))),
    d.clients.length ? clientSearch(d.clients) : h('p', { class: 'muted' }, 'No clients yet.'),
  ].filter(Boolean));
}

const CLIENT_STATUS = { inquiry: 'Reached out', paperwork_received: 'Information submitted', baseline: 'Baseline', active: 'Active' };

/** Search box + status filter above the client chips; filters the list in place as Totty types. */
function clientSearch(clients) {
  const list = h('ul', { class: 'client-chips' });
  const empty = h('p', { class: 'muted' }, 'No clients match.');
  const search = h('input', { type: 'search', class: 'client-search', placeholder: 'Search clients by name…', 'aria-label': 'Search clients by name' });
  const filter = h('select', { class: 'client-filter', 'aria-label': 'Filter by status' },
    h('option', { value: '' }, 'All statuses'),
    ...Object.entries(CLIENT_STATUS).map(([k, label]) => h('option', { value: k }, label)));
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const shown = clients.filter((c) => (!filter.value || c.intake_status === filter.value)
      && (!q || `${c.first_name} ${c.last_name}`.toLowerCase().includes(q) || `${c.last_name} ${c.first_name}`.toLowerCase().includes(q)));
    list.replaceChildren(...shown.map((c) => h('li', {}, h('a', { href: `#/client/${c.id}`, class: 'client-chip' },
      h('span', { class: 'avatar avatar-lg' }, `${c.first_name[0] ?? ''}${c.last_name[0] ?? ''}`.toUpperCase()),
      h('span', { class: 'client-chip-text' },
        h('span', { class: 'client-chip-head' },
          h('span', { class: 'client-chip-name' }, `${c.first_name} ${c.last_name}`),
          h('span', { class: `badge client-chip-status ${c.intake_status === 'active' ? 'ok' : ''}` }, CLIENT_STATUS[c.intake_status] ?? c.intake_status)),
        c.attention.length ? h('span', { class: 'chip-attn', title: c.attention.join('; ') }, `⚠ ${c.attention.join('; ')}`) : null),
      h('span', { class: 'client-chip-arrow', 'aria-hidden': 'true' }, '›')))));
    empty.hidden = shown.length > 0;
  };
  search.addEventListener('input', draw);
  filter.addEventListener('change', draw);
  draw();
  return h('div', {}, h('div', { class: 'client-search-bar' }, search, filter), list, empty);
}

const fmtTimeShort = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
let scheduleMonth = null; // first day of the month being viewed
const KIND_LABEL = { initial_consultation: 'Initial Consultation', first_checkin: 'First check-in (Baseline)', biweekly_checkin: 'Bi-weekly check-in' };

/** Schedule: month calendar of appointments. Chips show first name and time; clicking one opens that appointment's page. */
async function renderAppointments() {
  const today = new Date();
  scheduleMonth ??= new Date(today.getFullYear(), today.getMonth(), 1);
  const first = scheduleMonth;
  const next = new Date(first.getFullYear(), first.getMonth() + 1, 1);
  const list = await api(`/appointments?from=${encodeURIComponent(first.toISOString())}&to=${encodeURIComponent(next.toISOString())}`);
  logoutBtn.hidden = false;

  const byDay = new Map();
  for (const a of list) {
    const k = new Date(a.starts_at).getDate();
    byDay.set(k, [...(byDay.get(k) ?? []), a]);
  }
  const go = (delta) => { scheduleMonth = delta === 0 ? null : new Date(first.getFullYear(), first.getMonth() + delta, 1); renderAppointments(); };

  const lead = first.getDay();
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(h('div', { class: 'cal-cell cal-empty' }));
  for (let d = 1; d <= days; d++) {
    const isToday = d === today.getDate() && first.getMonth() === today.getMonth() && first.getFullYear() === today.getFullYear();
    cells.push(h('div', { class: `cal-cell${isToday ? ' cal-today' : ''}` },
      h('span', { class: 'cal-day' }, String(d)),
      (byDay.get(d) ?? []).map((a) => h('a', { href: `#/appointment/${a.id}`, class: 'appt-chip', title: KIND_LABEL[a.kind],
        'aria-label': `${KIND_LABEL[a.kind]}, ${a.client_id ? a.first_name : 'Unmatched client'} ${fmtTimeShort(a.starts_at)}: open appointment` },
        `${a.client_id ? a.first_name : 'Unmatched'} ${fmtTimeShort(a.starts_at)}`))));
  }

  app.replaceChildren(
    h('div', { class: 'cal-head' },
      h('h2', {}, first.toLocaleDateString([], { month: 'long', year: 'numeric' })),
      h('span', { class: 'spacer' }),
      h('div', { class: 'range' },
        h('button', { type: 'button', onclick: () => go(-1), 'aria-label': 'Previous month' }, '‹'),
        h('button', { type: 'button', onclick: () => go(0) }, 'Today'),
        h('button', { type: 'button', onclick: () => go(1), 'aria-label': 'Next month' }, '›'))),
    h('div', { class: 'cal' },
      ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((n) => h('div', { class: 'cal-dow' }, n)),
      cells),
    ...(list.length ? [] : [h('p', { class: 'muted' }, 'Nothing scheduled this month.')]));
}

const renderClient = (id, tab) => renderClientPage({ h, api, app, logoutBtn, handle }, id, tab);

/** Edit form for an existing client (clients are created only by the online intake form). Sends every field, so a cleared optional field is cleared. */
function renderClientForm(c) {
  logoutBtn.hidden = false;
  const msg = h('p', { class: 'error', role: 'alert' });
  const v = (k) => (c?.[k] == null ? '' : String(c[k]).slice(0, k === 'dob' || k === 'admission_date' ? 10 : undefined));
  const field = (label, name, attrs = {}) => h('label', {}, label, h('input', { name, value: v(name), ...attrs }));
  const OPTIONAL = ['gender', 'dob', 'location_name', 'street_address', 'city', 'state', 'zip', 'candle_lighting_minutes', 'notes'];
  const form = h('form', { class: 'login', onsubmit: async (e) => {
    e.preventDefault();
    msg.textContent = '';
    const f = new FormData(form);
    const body = {};
    for (const [k, val] of f.entries()) {
      const t = String(val).trim();
      if (t !== '') body[k] = t;
      else if (c && OPTIONAL.includes(k)) body[k] = null;
    }
    body.in_israel = f.get('in_israel') === 'on';
    try {
      const saved = await api(`/clients/${c.id}`, { method: 'PATCH', body });
      location.hash = `#/client/${saved.id}`;
    } catch (ex) { msg.textContent = ex.message; }
  } },
    field('First name', 'first_name', { required: true }),
    field('Last name', 'last_name', { required: true }),
    field('Gender', 'gender'),
    field('Date of birth', 'dob', { type: 'date' }),
    field('Admission date', 'admission_date', { type: 'date', required: true }),
    field('Street address', 'street_address', { placeholder: 'e.g. 123 Main St' }),
    field('City', 'city'),
    field('ZIP', 'zip', { inputmode: 'numeric', maxlength: 10 }),
    h('label', {}, 'State', h('select', { name: 'state' }, h('option', { value: '' }, '—'), ...['NY', 'NJ'].map((s) => h('option', { value: s, selected: c?.state === s }, s)))),
    field('Location name', 'location_name', { placeholder: 'e.g. Brooklyn, NY' }),
    field('Latitude', 'latitude', { type: 'number', step: 'any', min: -90, max: 90, required: true }),
    field('Longitude', 'longitude', { type: 'number', step: 'any', min: -180, max: 180, required: true }),
    field('Timezone', 'timezone', { required: true, ...(c ? {} : { value: Intl.DateTimeFormat().resolvedOptions().timeZone }) }),
    h('label', {}, h('input', { name: 'in_israel', type: 'checkbox', checked: Boolean(c?.in_israel) }), ' Lives in Israel (Yom Tov observance)'),
    field('Candle lighting (minutes before sunset)', 'candle_lighting_minutes', { type: 'number', min: 0, placeholder: 'default 18' }),
    h('label', {}, 'Notes', h('textarea', { name: 'notes', rows: 3 }, c?.notes ?? '')),
    h('button', { type: 'submit' }, 'Save changes'), msg);
  const archive = c && h('p', {}, h('button', { type: 'button', class: 'link', onclick: async () => {
    const restoring = c.status === 'archived';
    if (!restoring && !confirm(`Archive ${c.first_name}? Prompts stop and the client leaves the dashboard. History is kept and you can restore later.`)) return;
    try { await api(`/clients/${c.id}/archive`, { method: 'POST', body: { restore: restoring } }); location.hash = '#/'; } catch (ex) { msg.textContent = ex.message; }
  } }, c.status === 'archived' ? 'Restore client' : 'Archive client'));
  app.replaceChildren(h('p', {}, h('a', { href: `#/client/${c.id}` }, '← Back to client')), h('h2', {}, `Edit ${c.first_name} ${c.last_name}`), form, archive);
}

async function renderArchived() {
  logoutBtn.hidden = false;
  const list = await api('/clients?status=archived');
  app.replaceChildren(h('h2', {}, 'Archived clients'),
    list.length
      ? h('ul', {}, list.map((c) => h('li', {}, `${c.first_name} ${c.last_name} — `, h('a', { href: `#/client/${c.id}/edit` }, 'Open to restore'))))
      : h('p', { class: 'muted' }, 'No archived clients.'));
}

const renderEditClient = async (id) => renderClientForm(await api(`/clients/${id}`));

function handle(err) {
  if (err instanceof Locked) return renderLocked(err.body);
  if (err.message === 'login') return;
  app.replaceChildren(h('p', { class: 'error', role: 'alert' }, err.message));
}

async function route() {
  const m = /^#\/client\/([0-9a-f-]{36})(?:\/(profile|goals|progress|appointments))?$/i.exec(location.hash);
  // Client pages set 'wide' themselves; resetting it here would squeeze the old page narrower
  // while the next tab loads, then widen it again (the flicker). Reset only for other pages.
  if (!m) app.className = '';
  const contactsRoute = /^#\/client\/([0-9a-f-]{36})\/contacts$/i.exec(location.hash);
  const reportRoute = /^#\/report\/([0-9a-f-]{36})$/i.exec(location.hash);
  const edit = /^#\/client\/([0-9a-f-]{36})\/edit$/i.exec(location.hash);
  const apptRoute = /^#\/appointment\/([0-9a-f-]{36})$/i.exec(location.hash);
  try { await (apptRoute ? renderAppointment({ h, api, app, logoutBtn, handle }, apptRoute[1]) : location.hash === '#/archived' ? renderArchived() : location.hash === '#/clients' ? renderClients() : location.hash === '#/appointments' ? renderAppointments() : location.hash === '#/settings' ? renderSettings({ h, api, app, logoutBtn }) : edit ? renderEditClient(edit[1]) : reportRoute ? renderReport({ h, api, app, logoutBtn, handle }, reportRoute[1]) : contactsRoute ? renderContacts({ h, api, app, logoutBtn, handle }, contactsRoute[1]) : m ? renderClient(m[1], m[2]) : renderDashboard()); } catch (e) { handle(e); }
}

async function boot() {
  if (location.pathname === '/intake') return renderInfoPage({ h, app }).catch(handle); // public intake form, no login
  try {
    const s = await (await fetch('/api/status')).json();
    showingLocked = false;
    if (s.locked) return renderLocked({ kind: s.kind, reopensAt: s.reopensAt });
    if (!s.authenticated) return renderLogin();
    await route();
  } catch (e) { handle(e); }
}

logoutBtn.addEventListener('click', async () => { await api('/logout', { method: 'POST' }).catch(() => {}); renderLogin(); });
if (location.pathname !== '/intake') window.addEventListener('hashchange', route);
// Pick up the Shabbos lock and reopening without a manual refresh, without redrawing
// (and wiping a half-typed form) while the app is open and unlocked.
setInterval(async () => {
  if (location.pathname === '/intake') return;
  try {
    const s = await (await fetch('/api/status')).json();
    if (s.locked !== showingLocked) boot();
  } catch { /* offline: keep what is on screen */ }
}, 60_000);
boot();
