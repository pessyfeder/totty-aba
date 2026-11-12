// Dashboard UI (SPEC 5.7). DOM is built with textContent only: parent replies are untrusted text.
import { renderClient as renderClientPage } from './client-page.js';
import { renderContacts } from './contacts-page.js';
import { renderReport } from './reports-page.js';
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

const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtDateTime = (iso) => new Date(iso).toLocaleString([], { weekday: 'long', hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' });
const STATUS = { scheduled: 'Scheduled', deferred: 'Deferred', sending: 'Sending', sent: 'Sent', answered: 'Answered', no_response: 'No response', skipped: 'Skipped', failed: 'Failed' };

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

// Open/closed state of collapsibles survives re-renders (e.g. the reload after saving a reply).
const openState = new Map([['attention', true], ['replies', true], ['clients', true]]);
function collapsible(key, summaryKids, body, { cls = '' } = {}) {
  const d = h('details', { class: `fold ${cls}` }, h('summary', {}, summaryKids), body);
  d.open = openState.get(key) ?? false;
  d.addEventListener('toggle', () => openState.set(key, d.open));
  return d;
}
const badge = (text, kind = '') => h('span', { class: `badge ${kind}` }, text);

function clientRow(c, prompts) {
  const done = prompts.filter((p) => p.status === 'answered').length;
  const bad = prompts.some((p) => ['no_response', 'failed'].includes(p.status));
  const head = [
    h('a', { href: `#/client/${c.id}`, class: 'name' }, `${c.first_name} ${c.last_name}`),
    c.attention.length ? badge(`⚠ ${c.attention.length}`, 'bad') : '',
    prompts.length ? badge(`${done}/${prompts.length} today`, bad ? 'bad' : done === prompts.length ? 'ok' : '') : '',
  ];
  const body = h('div', { class: 'row-body' },
    c.attention.map((a) => h('div', { class: 'warn-line' }, `⚠ ${a}`)),
    prompts.map((p) => h('div', { class: 'muted' }, `${fmtTime(p.scheduled_for)} · ${p.title} · ${STATUS[p.status] ?? p.status}`)),
    c.reinforcements.length
      ? h('ul', { class: 'chips' }, c.reinforcements.map((i) => h('li', { title: i.note ?? '' }, i.name)))
      : h('div', { class: 'muted' }, 'No reinforcements recorded'));
  const el = collapsible(`client:${c.id}`, head, body, { cls: 'row' });
  el.dataset.name = `${c.first_name} ${c.last_name}`.toLowerCase();
  el.dataset.attn = c.attention.length ? '1' : '';
  return el;
}

async function renderDashboard() {
  const d = await api('/dashboard');
  logoutBtn.hidden = false;
  const reload = () => renderDashboard().catch(handle);
  const sh = d.shabbos;
  const byClient = new Map();
  for (const p of d.today) byClient.set(p.client_id, [...(byClient.get(p.client_id) ?? []), p]);
  const answered = d.today.filter((p) => p.status === 'answered').length;
  const rows = d.clients.map((c) => clientRow(c, byClient.get(c.id) ?? []));

  const filter = h('input', { type: 'search', placeholder: `Filter ${d.clients.length} clients…`, 'aria-label': 'Filter clients', class: 'filter' });
  const onlyAttn = h('input', { type: 'checkbox' });
  const count = h('span', { class: 'muted' });
  const apply = () => {
    const q = filter.value.trim().toLowerCase();
    let n = 0;
    for (const r of rows) {
      const show = (!q || r.dataset.name.includes(q)) && (!onlyAttn.checked || r.dataset.attn);
      r.hidden = !show;
      if (show) n++;
    }
    count.textContent = `${n} shown`;
  };
  filter.addEventListener('input', apply);
  onlyAttn.addEventListener('change', apply);
  const setAll = (open) => rows.forEach((r) => { if (!r.hidden) r.open = open; });

  const clientsBody = h('div', {},
    h('div', { class: 'toolbar' }, filter,
      h('label', { class: 'check' }, onlyAttn, ' Needs attention'),
      h('button', { type: 'button', class: 'link', onclick: () => setAll(true) }, 'Expand all'),
      h('button', { type: 'button', class: 'link', onclick: () => setAll(false) }, 'Collapse all'),
      count),
    d.clients.length ? h('div', { class: 'rows' }, rows) : h('p', { class: 'muted' }, 'No clients yet.'));

  app.replaceChildren(...[
    sh && sh.active && h('div', { class: 'banner' }, `Shabbos window in effect until ${fmtDateTime(sh.end)}.`),
    h('div', { class: 'stats' },
      h('span', {}, h('strong', {}, String(d.clients.length)), ' clients'),
      h('span', { class: d.attention.length ? 'bad' : '' }, h('strong', {}, String(d.attention.length)), ' need attention'),
      h('span', {}, h('strong', {}, `${answered}/${d.today.length}`), ' answered today'),
      h('span', { class: 'spacer' }),
      h('a', { href: '#/client/new', class: 'button' }, '+ Add client'), h('a', { href: '#/archived' }, 'Archived')),
    d.attention.length > 0 && collapsible('attention', [h('strong', {}, 'Needs attention'), badge(String(d.attention.length), 'bad')],
      h('ul', { class: 'list tight' }, d.attention.map((c) => h('li', {}, h('a', { href: `#/client/${c.id}` }, `${c.first_name} ${c.last_name}`), ` — ${c.attention.join('; ')}`)))),
    collapsible('clients', [h('strong', {}, 'Clients'), badge(String(d.clients.length))], clientsBody),
    collapsible('today', [h('strong', {}, "Today's prompts"), badge(`${answered}/${d.today.length} answered`)],
      d.today.length
        ? h('div', { class: 'scroll' }, h('table', { class: 'compact' },
            h('tbody', {}, d.today.map((p) => h('tr', {},
              h('td', {}, fmtTime(p.scheduled_for)), h('td', {}, p.first_name), h('td', {}, p.title),
              h('td', { class: `s-${p.status}` }, STATUS[p.status] ?? p.status, p.status === 'deferred' && p.deferred_reason ? ` (${p.deferred_reason.replace('_', ' ')})` : ''))))))
        : h('p', { class: 'muted' }, 'Nothing scheduled today.')),
  ].filter(Boolean));
  apply();
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
  try { await (location.hash === '#/archived' ? renderArchived() : location.hash === '#/client/new' ? renderAddClient() : edit ? renderEditClient(edit[1]) : reportRoute ? renderReport({ h, api, app, logoutBtn, handle }, reportRoute[1]) : contactsRoute ? renderContacts({ h, api, app, logoutBtn, handle }, contactsRoute[1]) : m ? renderClient(m[1]) : renderDashboard()); } catch (e) { handle(e); }
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
