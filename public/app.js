// Dashboard UI (SPEC 5.7). DOM is built with textContent only: parent replies are untrusted text.
import { renderClient as renderClientPage } from './client-page.js';
import { renderContacts } from './contacts-page.js';
import { renderReport } from './reports-page.js';
import { renderSettings } from './settings-page.js';
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

/** Creates a client straight from a returned intake form (SPEC 5.1a step 3). */
function newFromForm() {
  const input = h('input', { type: 'file', accept: '.csv,.json', required: true });
  const msg = h('span', { class: 'error', role: 'alert' });
  const form = h('form', { class: 'inline-form', onsubmit: async (e) => {
    e.preventDefault();
    msg.textContent = '';
    const file = input.files[0];
    try {
      const res = await fetch('/api/intake/form', { method: 'POST', body: file,
        headers: { 'Content-Type': 'application/octet-stream', 'X-Requested-With': 'totty', 'X-Filename': encodeURIComponent(file.name) } });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.client_id) { msg.replaceChildren(`${data.error}. `, h('a', { href: `#/client/${data.client_id}` }, 'Open client')); return; }
      if (!res.ok) throw new Error(data.error ?? `Upload failed (${res.status})`);
      alert(`Client created from the form. Their location and timezone were set to yours; edit the client to set the family's.${data.warnings.length ? `

Check: ${data.warnings.join('; ')}` : ''}`);
      location.hash = `#/client/${data.client_id}`;
    } catch (ex) { msg.textContent = ex.message; }
  } }, h('label', {}, 'New client from returned intake form (.csv or .json)', input), h('button', { type: 'submit' }, 'Create client'), msg);
  return form;
}

async function renderDashboard() {
  const d = await api('/dashboard');
  logoutBtn.hidden = false;
  const sh = d.shabbos;
  app.replaceChildren(...[
    sh && sh.active && h('div', { class: 'banner' }, `Shabbos window in effect until ${fmtDateTime(sh.end)}.`),
    h('div', { class: 'stats' },
      h('h2', {}, 'Clients'),
      h('span', { class: d.attention.length ? 'bad' : '' }, h('strong', {}, String(d.attention.length)), ' need attention'),
      h('span', { class: 'spacer' }),
      h('a', { href: '#/client/new', class: 'button' }, '+ Add client'), h('a', { href: '#/archived' }, 'Archived'), h('a', { href: '#/settings' }, 'Settings')),
    newFromForm(),
    ...(d.emailsToApprove ?? []).map((c) => h('div', { class: 'warn-line' }, `✉ Consultation email for ${c.first_name} ${c.last_name} is waiting for your approval. `,
      h('a', { href: `#/client/${c.id}` }, 'Review'))),
    h('h2', {}, 'Upcoming appointments'),
    d.appointments.length
      ? h('table', { class: 'compact' }, h('tbody', {}, d.appointments.map((a) => h('tr', {},
          h('td', {}, fmtDateTime(a.starts_at)),
          h('td', {}, a.client_id ? h('a', { href: `#/client/${a.client_id}` }, `${a.first_name} ${a.last_name}`) : h('span', { class: 'muted' }, 'Unmatched client')),
          h('td', {}, a.type)))))
      : h('p', { class: 'muted' }, 'No upcoming appointments.'),
    d.clients.length
      ? h('ul', { class: 'list' }, d.clients.map((c) => h('li', {}, h('a', { href: `#/client/${c.id}`, class: 'name' }, `${c.first_name} ${c.last_name}`),
        ...c.attention.map((a) => h('span', { class: 'warn-line' }, ` ⚠ ${a}`)))))
      : h('p', { class: 'muted' }, 'No clients yet.'),
  ].filter(Boolean));
}

const renderClient = (id) => renderClientPage({ h, api, app, logoutBtn, handle }, id);

/** Add (c == null) or edit (c = existing client) form. Editing sends every field, so a cleared optional field is cleared. */
function renderClientForm(c = null) {
  logoutBtn.hidden = false;
  const msg = h('p', { class: 'error', role: 'alert' });
  const v = (k) => (c?.[k] == null ? '' : String(c[k]).slice(0, k === 'dob' || k === 'admission_date' ? 10 : undefined));
  const field = (label, name, attrs = {}) => h('label', {}, label, h('input', { name, value: v(name), ...attrs }));
  const OPTIONAL = ['gender', 'dob', 'location_name', 'candle_lighting_minutes', 'notes'];
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
      const saved = c ? await api(`/clients/${c.id}`, { method: 'PATCH', body }) : await api('/clients', { method: 'POST', body });
      location.hash = `#/client/${saved.id}`;
    } catch (ex) { msg.textContent = ex.message; }
  } },
    field('First name', 'first_name', { required: true }),
    field('Last name', 'last_name', { required: true }),
    field('Gender', 'gender'),
    field('Date of birth', 'dob', { type: 'date' }),
    field('Admission date', 'admission_date', { type: 'date', required: true }),
    field('Location name', 'location_name', { placeholder: 'e.g. Brooklyn, NY' }),
    field('Latitude', 'latitude', { type: 'number', step: 'any', min: -90, max: 90, required: true }),
    field('Longitude', 'longitude', { type: 'number', step: 'any', min: -180, max: 180, required: true }),
    field('Timezone', 'timezone', { required: true, ...(c ? {} : { value: Intl.DateTimeFormat().resolvedOptions().timeZone }) }),
    h('label', {}, h('input', { name: 'in_israel', type: 'checkbox', checked: Boolean(c?.in_israel) }), ' Lives in Israel (Yom Tov observance)'),
    field('Candle lighting (minutes before sunset)', 'candle_lighting_minutes', { type: 'number', min: 0, placeholder: 'default 18' }),
    h('label', {}, 'Notes', h('textarea', { name: 'notes', rows: 3 }, c?.notes ?? '')),
    h('button', { type: 'submit' }, c ? 'Save changes' : 'Add client'), msg);
  const archive = c && h('p', {}, h('button', { type: 'button', class: 'link', onclick: async () => {
    const restoring = c.status === 'archived';
    if (!restoring && !confirm(`Archive ${c.first_name}? Prompts stop and the client leaves the dashboard. History is kept and you can restore later.`)) return;
    try { await api(`/clients/${c.id}/archive`, { method: 'POST', body: { restore: restoring } }); location.hash = '#/'; } catch (ex) { msg.textContent = ex.message; }
  } }, c.status === 'archived' ? 'Restore client' : 'Archive client'));
  app.replaceChildren(h('p', {}, h('a', { href: c ? `#/client/${c.id}` : '#/' }, c ? '← Back to client' : '← Dashboard')), h('h2', {}, c ? `Edit ${c.first_name} ${c.last_name}` : 'Add client'), form, archive || '');
}

async function renderArchived() {
  logoutBtn.hidden = false;
  const list = await api('/clients?status=archived');
  app.replaceChildren(h('p', {}, h('a', { href: '#/' }, '← Dashboard')), h('h2', {}, 'Archived clients'),
    list.length
      ? h('ul', {}, list.map((c) => h('li', {}, `${c.first_name} ${c.last_name} — `, h('a', { href: `#/client/${c.id}/edit` }, 'Open to restore'))))
      : h('p', { class: 'muted' }, 'No archived clients.'));
}

const renderAddClient = () => renderClientForm();
const renderEditClient = async (id) => renderClientForm(await api(`/clients/${id}`));

function handle(err) {
  if (err instanceof Locked) return renderLocked(err.body);
  if (err.message === 'login') return;
  app.replaceChildren(h('p', { class: 'error', role: 'alert' }, err.message));
}

async function route() {
  const m = /^#\/client\/([0-9a-f-]{36})$/i.exec(location.hash);
  const contactsRoute = /^#\/client\/([0-9a-f-]{36})\/contacts$/i.exec(location.hash);
  const reportRoute = /^#\/report\/([0-9a-f-]{36})$/i.exec(location.hash);
  const edit = /^#\/client\/([0-9a-f-]{36})\/edit$/i.exec(location.hash);
  try { await (location.hash === '#/archived' ? renderArchived() : location.hash === '#/settings' ? renderSettings({ h, api, app, logoutBtn }) : location.hash === '#/client/new' ? renderAddClient() : edit ? renderEditClient(edit[1]) : reportRoute ? renderReport({ h, api, app, logoutBtn, handle }, reportRoute[1]) : contactsRoute ? renderContacts({ h, api, app, logoutBtn, handle }, contactsRoute[1]) : m ? renderClient(m[1]) : renderDashboard()); } catch (e) { handle(e); }
}

async function boot() {
  try {
    const s = await (await fetch('/api/status')).json();
    showingLocked = false;
    if (s.locked) return renderLocked({ kind: s.kind, reopensAt: s.reopensAt });
    if (!s.authenticated) return renderLogin();
    await route();
  } catch (e) { handle(e); }
}

logoutBtn.addEventListener('click', async () => { await api('/logout', { method: 'POST' }).catch(() => {}); renderLogin(); });
window.addEventListener('hashchange', route);
// Pick up the Shabbos lock and reopening without a manual refresh, without redrawing
// (and wiping a half-typed form) while the app is open and unlocked.
setInterval(async () => {
  try {
    const s = await (await fetch('/api/status')).json();
    if (s.locked !== showingLocked) boot();
  } catch { /* offline: keep what is on screen */ }
}, 60_000);
boot();
