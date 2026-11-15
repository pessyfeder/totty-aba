// Settings UI (SPEC 5.1a, 5.7b): links to the external booking pages. The app only stores and sends them.
const FIELDS = [
  ['consult_booking_url', 'Consultation booking link', 'Emailed once intake paperwork is received (Google Calendar appointment schedule).'],
  ['checkin_booking_url', 'Ongoing meeting booking link', 'Sent in the bi-weekly check-in text (every 14 days).'],
];

export async function renderSettings({ h, api, app, logoutBtn }) {
  const s = await api('/settings');
  const msg = h('span', { role: 'status' });
  const inputs = FIELDS.map(([k]) => h('input', { name: k, type: 'url', value: s[k], placeholder: 'https://calendar.google.com/...', autocomplete: 'off' }));
  const form = h('form', { class: 'form', onsubmit: async (e) => {
    e.preventDefault();
    msg.className = 'muted'; msg.textContent = 'Saving…';
    try {
      await api('/settings', { method: 'PUT', body: Object.fromEntries(inputs.map((i) => [i.name, i.value])) });
      msg.className = ''; msg.textContent = 'Saved.';
    } catch (ex) { msg.className = 'error'; msg.textContent = ex.message; }
  } },
    FIELDS.map(([k, label, hint], i) => h('label', {}, label, inputs[i], h('small', { class: 'muted' }, hint))),
    h('p', {}, h('button', { type: 'submit' }, 'Save'), ' ', msg));
  logoutBtn.hidden = false;
  app.replaceChildren(h('p', {}, h('a', { href: '#/' }, '← Dashboard')), h('h2', {}, 'Settings'), h('h3', {}, 'Booking links'), form);
}
