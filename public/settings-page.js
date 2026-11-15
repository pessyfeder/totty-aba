// Settings UI (SPEC 5.1a, 5.7b): links to the external booking pages. The app only stores and sends them.
const FIELDS = [
  ['consult_booking_url', 'Consultation booking link', 'Emailed once intake paperwork is received (Google Calendar appointment schedule).'],
  ['checkin_booking_url', 'Ongoing meeting booking link', 'Sent in the bi-weekly check-in text (every 14 days).'],
];

export async function renderSettings({ h, api, app, logoutBtn }) {
  const s = await api('/settings');
  const msg = h('span', { role: 'status' });
  const preview = h('blockquote', { class: 'muted', style: 'overflow-wrap:anywhere;margin:.25rem 0 1rem;border-left:3px solid #ccd;padding-left:.75rem' }, s.checkin_text_preview);
  const inputs = FIELDS.map(([k]) => h('input', { name: k, type: 'url', value: s[k], placeholder: 'https://calendar.google.com/...', autocomplete: 'off' }));
  const cal = h('input', { name: 'calendar_ics_url', type: 'url', autocomplete: 'off',
    placeholder: s.calendar_connected ? 'Connected. Paste a new address to replace it.' : 'https://calendar.google.com/calendar/ical/.../basic.ics' });
  const calMsg = h('span', { role: 'status' });
  const syncBtn = h('button', { type: 'button', onclick: async () => {
    calMsg.className = 'muted'; calMsg.textContent = 'Syncing…';
    try {
      const r = await api('/calendar/sync', { method: 'POST' });
      calMsg.className = ''; calMsg.textContent = `Synced: ${r.created} new, ${r.updated} changed, ${r.cancelled} cancelled.`;
    } catch (ex) { calMsg.className = 'error'; calMsg.textContent = ex.message; }
  } }, 'Sync now');
  const disconnectBtn = h('button', { type: 'button', onclick: async () => {
    if (!confirm('Disconnect the calendar? Existing appointments stay, but no new ones are synced.')) return;
    try {
      await api('/settings', { method: 'PUT', body: { calendar_ics_url: '' } });
      cal.placeholder = 'https://calendar.google.com/calendar/ical/.../basic.ics';
      calMsg.className = ''; calMsg.textContent = 'Disconnected.';
    } catch (ex) { calMsg.className = 'error'; calMsg.textContent = ex.message; }
  } }, 'Disconnect');
  const form = h('form', { class: 'form', onsubmit: async (e) => {
    e.preventDefault();
    msg.className = 'muted'; msg.textContent = 'Saving…';
    try {
      const body = Object.fromEntries(inputs.map((i) => [i.name, i.value]));
      if (cal.value.trim()) body.calendar_ics_url = cal.value.trim(); // blank keeps the connected calendar
      await api('/settings', { method: 'PUT', body });
      if (cal.value.trim()) { cal.value = ''; cal.placeholder = 'Connected. Paste a new address to replace it.'; }
      preview.textContent = (await api('/settings')).checkin_text_preview;
      msg.className = ''; msg.textContent = 'Saved.';
    } catch (ex) { msg.className = 'error'; msg.textContent = ex.message; }
  } },
    FIELDS.flatMap(([k, label, hint], i) => [
      h('label', {}, label, inputs[i], h('small', { class: 'muted' }, hint)),
      ...(k === 'checkin_booking_url' ? [h('small', {}, 'Preview of the check-in text:'), preview] : [])]),
    h('h3', {}, 'Google Calendar (read-only)'),
    h('label', {}, 'Secret iCal address', cal, h('small', { class: 'muted' }, 'Google Calendar → Settings → your calendar → Integrate calendar → "Secret address in iCal format". The app only reads it and never changes your calendar. Keep it private.')),
    h('p', {}, h('button', { type: 'submit' }, 'Save'), ' ', msg),
    h('p', {}, syncBtn, ' ', disconnectBtn, ' ', calMsg));
  logoutBtn.hidden = false;
  app.replaceChildren(h('p', {}, h('a', { href: '#/' }, '← Dashboard')), h('h2', {}, 'Settings'), h('h3', {}, 'Booking links'), form);
}
