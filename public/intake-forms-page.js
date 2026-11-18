// Intake forms waiting to be copied into a client (SPEC 5.1a). Forms whose child's name matches exactly one client are
// copied automatically; the rest are listed here for Yisroel to pick the client or create a new one.
export async function renderIntakeForms({ h, api, app, logoutBtn, handle }) {
  logoutBtn.hidden = false;
  const [subs, clients] = await Promise.all([api('/intake-submissions'), api('/clients')]);
  const msg = h('p', { class: 'error', role: 'alert' });
  const done = async (path, body) => {
    msg.textContent = '';
    try {
      const r = await api(path, { method: 'POST', body });
      location.hash = `#/client/${r.client_id}`;
    } catch (e) { msg.textContent = e.message; }
  };
  const when = (iso) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const card = (s) => {
    const sel = h('select', { 'aria-label': `Client for ${s.child_first_name} ${s.child_last_name}` },
      h('option', { value: '' }, 'Choose a client\u2026'),
      [...clients].sort((a, b) => Number(s.suggested.includes(b.id)) - Number(s.suggested.includes(a.id)))
        .map((c) => h('option', { value: c.id }, `${c.first_name} ${c.last_name}${s.suggested.includes(c.id) ? ' (similar name)' : ''}`)));
    return h('div', { class: 'card' },
      h('h3', {}, `${s.child_first_name} ${s.child_last_name}`),
      h('p', { class: 'muted' }, `Submitted ${when(s.submitted_at)} by ${s.parent_name || 'a parent'}${s.state ? ` \u00b7 ${s.state}` : ''}`),
      h('div', { class: 'inline-form' }, sel,
        h('button', { type: 'button', onclick: () => (sel.value ? done(`/intake-submissions/${s.id}/import`, { client_id: sel.value }) : (msg.textContent = 'Choose a client first.')) }, 'Copy into client'),
        h('button', { type: 'button', class: 'link', onclick: () => done(`/intake-submissions/${s.id}/import`, { create: true }) }, 'Create new client')));
  };
  app.replaceChildren(
    h('h2', {}, 'Intake forms'),
    h('p', { class: 'muted' }, 'Forms from the public intake page are copied into the client with the same name automatically. These did not match exactly one client.'),
    msg,
    subs.length ? h('div', { class: 'grid' }, subs.map(card)) : h('p', { class: 'muted' }, 'No intake forms are waiting.'));
}
