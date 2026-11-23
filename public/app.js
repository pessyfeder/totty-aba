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
  for (const kid of kids.flat(Infinity)) if (kid !== false) node.append(kid instanceof Node ? kid : document.createTextNode(kid ?? ''));
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

const fmtDateTime = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' });

const NY = { timeZone: 'America/New_York' };
const fmtTime = (iso) => new Date(iso).toLocaleTimeString('en-US', { ...NY, hour: 'numeric', minute: '2-digit' });
const fmtDay = (iso) => new Date(iso).toLocaleDateString('en-US', { ...NY, weekday: 'long', month: 'short', day: 'numeric' });
/** Groups appointments (already sorted) by New York calendar day -> [[label, items]]. */
function groupByDay(list) {
  const map = new Map();
  for (const a of list) {
    const label = fmtDay(a.starts_at);
    if (!map.has(label)) map.set(label, []);
    map.get(label).push(a);
  }
  return [...map];
}

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

const NAV = [
  ['#/clients', 'clients', 'Clients', (hash) => hash.startsWith('#/clients') || hash.startsWith('#/client/') || hash === '#/archived'],
  ['#/appointments', 'appointments', 'Schedule', (hash) => hash === '#/' || hash === '' || hash.startsWith('#/appointment')],
  ['#/settings', 'settings', 'Settings', (hash) => hash === '#/settings'],
];
/** Sidebar navigation; hidden by CSS until logged in. */
const sidebar = document.getElementById('sidebar');
sidebar.append(...NAV.map(([href, key, label]) => h('a', { href, class: 'nav-link', 'data-key': key, title: label, 'aria-label': label },
  h('span', { class: 'side-icon' }, ICONS[key]()))));
// Show the sidebar exactly when the Log out button is visible (i.e. logged in). A MutationObserver avoids the
// stale :has() style invalidation some browsers show when #logout's hidden attribute changes.
const syncSidebar = () => { sidebar.hidden = logoutBtn.hidden; };
new MutationObserver(syncSidebar).observe(logoutBtn, { attributes: true, attributeFilter: ['hidden'] });
syncSidebar();
/** Red flashing dot beside each icon whose page needs attention (clients flagged, emails awaiting approval). */
function setAlert(key, on, text) {
  const a = sidebar.querySelector(`[data-key="${key}"]`);
  a.querySelector('.alert-dot')?.remove();
  if (on) a.append(h('span', { class: 'alert-dot', role: 'img', 'aria-label': text, title: text }));
}
async function refreshAlerts() {
  try {
    const d = await api('/dashboard');
    const n = (d.attention?.length ?? 0) + (d.emailsToApprove?.length ?? 0);
    setAlert('clients', n > 0, `${n} need${n === 1 ? 's' : ''} attention`);
  } catch { /* not logged in or locked: no flags */ }
}
function markActiveNav() {
  const hash = location.hash || '#/';
  for (const [, key, , test] of NAV) {
    const a = sidebar.querySelector(`[data-key="${key}"]`);
    if (test(hash)) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
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

const fmtTimeShort = (iso) => new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
let scheduleAnchor = null; // any date inside the month/week being viewed
let scheduleView = 'month'; // 'month' | 'week'
const KIND_LABEL = { initial_consultation: 'Initial Consultation', first_checkin: 'First check-in (Baseline)', biweekly_checkin: 'Weekly check-in' };

/** Schedule: month or week calendar of appointments. Chips show first name and time; clicking one opens that appointment's page. */
async function renderAppointments() {
  const today = new Date();
  const week = scheduleView === 'week';
  scheduleAnchor ??= new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const a0 = scheduleAnchor;
  const first = week ? new Date(a0.getFullYear(), a0.getMonth(), a0.getDate() - a0.getDay()) : new Date(a0.getFullYear(), a0.getMonth(), 1);
  const next = week ? new Date(first.getFullYear(), first.getMonth(), first.getDate() + 7) : new Date(first.getFullYear(), first.getMonth() + 1, 1);
  const list = await api(`/appointments?from=${encodeURIComponent(first.toISOString())}&to=${encodeURIComponent(next.toISOString())}`);
  logoutBtn.hidden = false;

  const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const byDay = new Map();
  for (const a of [...list].sort((x, y) => new Date(x.starts_at) - new Date(y.starts_at))) {
    const k = dayKey(new Date(a.starts_at));
    byDay.set(k, [...(byDay.get(k) ?? []), a]);
  }
  const go = (delta) => {
    scheduleAnchor = delta === 0 ? null : week ? new Date(first.getFullYear(), first.getMonth(), first.getDate() + 7 * delta) : new Date(first.getFullYear(), first.getMonth() + delta, 1);
    renderAppointments();
  };
  const setView = (v) => { scheduleView = v; renderAppointments(); };

  const cell = (date) => h('div', { class: `cal-cell${dayKey(date) === dayKey(today) ? ' cal-today' : ''}${week ? ' cal-week-cell' : ''}` },
    h('span', { class: 'cal-day' }, week ? date.toLocaleDateString([], { month: 'short', day: 'numeric' }) : String(date.getDate())),
    (byDay.get(dayKey(date)) ?? []).map((a) => h('a', { href: `#/appointment/${a.id}`, class: `appt-chip${a.status === 'held' ? ' appt-chip-held' : ''}`, title: KIND_LABEL[a.kind],
      'aria-label': `${KIND_LABEL[a.kind]}, ${a.client_id ? a.first_name : 'Unassigned client'} ${fmtTimeShort(a.starts_at)}: open appointment` },
      `${a.client_id ? a.first_name : 'Unassigned'} ${fmtTimeShort(a.starts_at)}`)));

  const cells = [];
  if (week) {
    for (let i = 0; i < 7; i++) cells.push(cell(new Date(first.getFullYear(), first.getMonth(), first.getDate() + i)));
  } else {
    for (let i = 0; i < first.getDay(); i++) cells.push(h('div', { class: 'cal-cell cal-empty' }));
    const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    for (let d = 1; d <= days; d++) cells.push(cell(new Date(first.getFullYear(), first.getMonth(), d)));
  }

  const last = new Date(next.getFullYear(), next.getMonth(), next.getDate() - 1);
  const title = week
    ? `${first.toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${last.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`
    : first.toLocaleDateString([], { month: 'long', year: 'numeric' });
  const unit = week ? 'week' : 'month';

  app.replaceChildren(
    h('div', { class: 'cal-head' },
      h('h2', {}, title),
      h('span', { class: 'spacer' }),
      h('div', { class: 'range' },
        h('button', { type: 'button', 'aria-pressed': String(!week), onclick: () => setView('month') }, 'Month'),
        h('button', { type: 'button', 'aria-pressed': String(week), onclick: () => setView('week') }, 'Week')),
      h('div', { class: 'range' },
        h('button', { type: 'button', onclick: () => go(-1), 'aria-label': `Previous ${unit}` }, '‹'),
        h('button', { type: 'button', onclick: () => go(0) }, 'Today'),
        h('button', { type: 'button', onclick: () => go(1), 'aria-label': `Next ${unit}` }, '›'))),
    h('div', { class: 'cal' },
      ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((n) => h('div', { class: 'cal-dow' }, n)),
      cells),
    ...(list.length ? [] : [h('p', { class: 'muted' }, `Nothing scheduled this ${unit}.`)]));
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
  markActiveNav();
  const m = /^#\/client\/([0-9a-f-]{36})(?:\/(profile|goals|progress|appointments))?$/i.exec(location.hash);
  // Client pages set 'wide' themselves; resetting it here would squeeze the old page narrower
  // while the next tab loads, then widen it again (the flicker). Reset only for other pages.
  if (!m) app.className = '';
  const contactsRoute = /^#\/client\/([0-9a-f-]{36})\/contacts$/i.exec(location.hash);
  const reportRoute = /^#\/report\/([0-9a-f-]{36})$/i.exec(location.hash);
  const edit = /^#\/client\/([0-9a-f-]{36})\/edit$/i.exec(location.hash);
  const apptRoute = /^#\/appointment\/([0-9a-f-]{36})$/i.exec(location.hash);
  try { await (apptRoute ? renderAppointment({ h, api, app, logoutBtn, handle }, apptRoute[1]) : location.hash === '#/archived' ? renderArchived() : location.hash === '#/clients' ? renderClients() : location.hash === '#/appointments' ? renderAppointments() : location.hash === '#/settings' ? renderSettings({ h, api, app, logoutBtn }) : edit ? renderEditClient(edit[1]) : reportRoute ? renderReport({ h, api, app, logoutBtn, handle }, reportRoute[1]) : contactsRoute ? renderContacts({ h, api, app, logoutBtn, handle }, contactsRoute[1]) : m ? renderClient(m[1], m[2]) : renderAppointments()); } catch (e) { handle(e); }
  refreshAlerts();
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
