// Settings UI (SPEC 5.1a, 5.7b): links to the external booking pages. The app only stores and sends them.
const FIELDS = [
  ['client_info_url', 'Client information page link', 'Link to the client information web page (one link; the family picks the New Jersey or New York section). Put in the first reply to a new inquiry, which you review and send.'],
  ['consult_booking_url', 'Consultation booking link', 'Link to the website scheduling portal. Emailed once intake paperwork is received.'],
  ['checkin_booking_url', 'Ongoing meeting booking link', 'Link to the website scheduling portal (booking and payment). Sent in the bi-weekly check-in text (every 14 days).'],
];

export async function renderSettings({ h, api, app, logoutBtn }) {
  const s = await api('/settings');
  const msg = h('span', { role: 'status' });
  const preview = h('blockquote', { class: 'muted', style: 'overflow-wrap:anywhere;margin:.25rem 0 1rem;border-left:3px solid #ccd;padding-left:.75rem' }, s.checkin_text_preview);
  const inputs = FIELDS.map(([k]) => h('input', { name: k, type: 'url', value: s[k], placeholder: 'https://calendar.google.com/...', autocomplete: 'off' }));
  const save = () => api('/settings', { method: 'PUT', body: Object.fromEntries(inputs.map((i) => [i.name, i.value])) });
  const say = (cls, t) => { msg.className = cls; msg.textContent = t; };

  // First reply to a new inquiry: the email text, the client information link, and a Send for one waiting client.
  const emailBox = h('div', { class: 'card' });
  // The link field sits inside the email body, on the line where the link appears.
  const linkInput = inputs[FIELDS.findIndex(([k]) => k === 'client_info_url')];
  linkInput.style.width = '100%';
  const showEmail = (e) => {
    const lines = e.text.split('\n');
    const at = lines.findIndex((l) => /^(https?:\/\/\S+|\[client information page link\])$/.test(l));
    const pre = (t) => h('pre', { style: 'white-space: pre-wrap; font: inherit; margin:0' }, t);
    emailBox.replaceChildren(
      e.to ? h('div', { class: 'muted' }, `To: ${e.to}`) : '',
      h('strong', {}, e.subject),
      ...(at < 0 ? [pre(e.text)] : [pre(lines.slice(0, at).join('\n')), linkInput, pre(lines.slice(at + 1).join('\n'))]));
  };
  const showTemplate = (t) => showEmail({ ...t, to: '' });
  showTemplate(s.first_reply_template);
  const problems = h('div', {});
  const sendBtn = h('button', { type: 'button', disabled: true }, 'Send');
  const picker = h('select', { onchange: async () => {
    problems.replaceChildren(); sendBtn.disabled = !picker.value;
    if (!picker.value) return showTemplate((await api('/settings')).first_reply_template);
    try {
      const e = await api(`/clients/${picker.value}/inquiry-email`);
      if (e.text) showEmail(e); else showTemplate(s.first_reply_template);
      problems.replaceChildren(...e.problems.map((p) => h('p', { class: 'warn-line' }, `⚠ ${p}`)));
    } catch (ex) { say('error', ex.message); }
  } }, h('option', { value: '' }, (s.first_reply_clients ?? []).length ? 'Choose a client…' : 'No new inquiries waiting'),
    (s.first_reply_clients ?? []).map((c) => h('option', { value: c.id }, `${c.first_name} ${c.last_name}`)));
  sendBtn.onclick = async () => {
    if (!picker.value || !confirm('Send this first reply email now?')) return;
    say('muted', 'Sending…');
    try {
      await save();
      await api(`/clients/${picker.value}/inquiry-email/approve`, { method: 'POST' });
      say('', 'Approved. It goes out now (not during Shabbos or Yom Tov).');
      picker.selectedOptions[0].remove(); picker.value = ''; sendBtn.disabled = true; problems.replaceChildren();
      showTemplate((await api('/settings')).first_reply_template);
    } catch (ex) { say('error', ex.message); }
  };
  const firstReply = [
    h('small', {}, 'First reply email to a new inquiry (text the family receives):'), emailBox,
    h('label', {}, 'Send to', picker), problems, h('p', {}, sendBtn)];

  const form = h('form', { class: 'form', onsubmit: async (e) => {
    e.preventDefault();
    say('muted', 'Saving…');
    try {
      await save();
      const f = await api('/settings');
      preview.textContent = f.checkin_text_preview;
      if (!picker.value) showTemplate(f.first_reply_template);
      say('', 'Saved.');
    } catch (ex) { say('error', ex.message); }
  } },
    FIELDS.flatMap(([k, label, hint], i) => [
      ...(k === 'client_info_url' ? [h('h3', {}, 'Intake')] : []),
      ...(k === 'consult_booking_url' ? [h('h3', {}, 'Booking links')] : []),
      ...(k === 'client_info_url'
        ? [h('small', { class: 'muted' }, hint), ...firstReply]
        : [h('label', {}, label, inputs[i], h('small', { class: 'muted' }, hint))]),
      ...(k === 'checkin_booking_url' ? [h('small', {}, 'Preview of the check-in text:'), preview] : [])]),
    h('p', {}, h('button', { type: 'submit' }, 'Save'), ' ', msg));
  logoutBtn.hidden = false;
  app.replaceChildren(h('p', {}, h('a', { href: '#/' }, '← Dashboard')), h('h2', {}, 'Settings'), form);
}
