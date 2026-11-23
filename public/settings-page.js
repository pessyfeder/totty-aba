// Settings UI (SPEC 5.1a, 5.7b): links to the external booking pages. The app only stores and sends them.
const FIELDS = [
  ['client_info_url', 'Client information page link', ''],
  ['consult_booking_url', 'Consultation booking link', 'Link to the website scheduling portal. Emailed once intake paperwork is received.'],
  ['checkin_booking_url', 'Ongoing meeting booking link', 'Link to the website scheduling portal (booking and payment). Sent in the weekly check-in text (every 7 days).'],
];

export async function renderSettings({ h, api, app, logoutBtn }) {
  const s = await api('/settings');
  const msg = h('span', { role: 'status' });
  const preview = h('blockquote', { class: 'muted', style: 'overflow-wrap:anywhere;margin:.25rem 0 1rem;border-left:3px solid #ccd;padding-left:.75rem' }, s.checkin_text_preview);
  const inputs = FIELDS.map(([k]) => h('input', { name: k, type: 'url', value: s[k], placeholder: k === 'client_info_url' ? 'Link to the client information web page' : 'https://calendar.google.com/...', autocomplete: 'off' }));
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
      h('div', {}, h('strong', {}, e.subject), ' ',
        h('button', { type: 'button', class: 'link', title: 'Edit the email', 'aria-label': 'Edit the email', onclick: startEdit }, '✎')),
      ...(at < 0 ? [pre(e.text), linkInput] : [pre(lines.slice(0, at).join('\n')), linkInput, pre(lines.slice(at + 1).join('\n'))]));
  };
  // The pencil: edit the email body (all families). {parent}, {child}, {link} and {sign} are filled in per family.
  const startEdit = () => {
    const box = h('textarea', { rows: 16, style: 'width:100%', 'aria-label': 'Email text' }, bodyText);
    const note = h('span', { role: 'alert', class: 'error' });
    const finish = async (value) => {
      try {
        await api('/settings', { method: 'PUT', body: { first_reply_body: value } });
        const f = await api('/settings');
        bodyText = f.first_reply_body;
        s.first_reply_template = f.first_reply_template;
        if (picker.value) picker.onchange(); else showTemplate(f.first_reply_template);
      } catch (ex) { note.textContent = ex.message; }
    };
    emailBox.replaceChildren(
      h('small', { class: 'muted' }, 'Keep {link} on its own line. {parent}, {child} and {sign} are replaced with the parent name, the child\'s first name and your name.'),
      box,
      h('p', {}, h('button', { type: 'button', onclick: () => finish(box.value) }, 'Save email'), ' ',
        h('button', { type: 'button', onclick: () => finish('') }, 'Reset to original'), ' ',
        h('button', { type: 'button', onclick: () => (picker.value ? picker.onchange() : showTemplate(s.first_reply_template)) }, 'Cancel'), ' ', note));
  };
  let bodyText = s.first_reply_body;
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
  // The public intake form: one general page for every family. Shown here so it can be copied and shared anywhere.
  const intakeUrl = `${location.origin}/intake`;
  const copied = h('span', { class: 'muted', role: 'status' });
  const intakeLink = h('p', {}, h('strong', {}, 'Online intake form link: '), h('a', { href: intakeUrl, target: '_blank', rel: 'noopener' }, intakeUrl), ' ',
    h('button', { type: 'button', class: 'link', onclick: async () => {
      try { await navigator.clipboard.writeText(intakeUrl); copied.textContent = 'Copied'; } catch { copied.textContent = 'Select the link and copy it'; }
    } }, 'Copy'), ' ', copied);
  const firstReply = [
    intakeLink,
    h('h3', {}, 'New client intake email'), emailBox,
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
        ? [...firstReply]
        : [h('label', {}, label, inputs[i], h('small', { class: 'muted' }, hint))]),
      ...(k === 'checkin_booking_url' ? [h('small', {}, 'Preview of the check-in text:'), preview] : [])]),
    h('p', {}, h('button', { type: 'submit' }, 'Save'), ' ', msg));
  logoutBtn.hidden = false;
  app.replaceChildren(h('h2', {}, 'Settings'), form);
}
