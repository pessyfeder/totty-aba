// Parents' Profile page (opened from the emailed link, /info/<token>). Same look as the app's Profile tab.
// Entries are saved as the parent types (Yisroel sees them right away); Submit checks the required fields.
const GENDERS = ['Male', 'Female', 'Other'];

export async function renderInfoPage({ h, app }, token) {
  const base = `/info-api/${encodeURIComponent(token)}`;
  const call = async (path, method, body) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error ?? `Request failed (${res.status})`), { missing: data.missing });
    return data;
  };
  let d;
  try { d = await call('', 'GET'); } catch (e) {
    app.replaceChildren(h('h2', {}, 'Link not valid'), h('p', {}, e.message));
    return;
  }

  const saved = h('span', { class: 'muted', role: 'status' });
  const msg = h('p', { class: 'error', role: 'alert' });
  const banner = h('div', { class: 'ok-line', role: 'status' }, d.submitted_at ? 'Submitted. Thank you! You can still update anything below and press Submit again.' : '');
  const required = (label, input) => h('label', {}, `${label} *`, input);
  const dob = h('input', { name: 'dob', type: 'date', value: d.dob ?? '', required: true, max: new Date().toISOString().slice(0, 10) });
  const gender = h('select', { name: 'gender', required: true }, h('option', { value: '' }, 'Select…'), GENDERS.map((g) => h('option', { value: g, selected: g === d.gender }, g)));
  const notes = h('textarea', { name: 'notes', rows: 4, placeholder: 'Background, interests, concerns' }, d.notes ?? '');
  const p = d.parent;
  const name = h('input', { name: 'name', value: p.name, required: true, autocomplete: 'name' });
  const relationship = h('input', { name: 'relationship', value: p.relationship, required: true, placeholder: 'e.g. Mother' });
  const phone = h('input', { name: 'phone', type: 'tel', value: p.phone, required: true, autocomplete: 'tel', placeholder: '(555) 555-0123' });
  const email = h('input', { name: 'email', type: 'email', value: p.email, required: true, autocomplete: 'email' });
  const consent = h('input', { name: 'consent', type: 'checkbox', checked: p.consent });
  const fields = { dob, gender, name, relationship, phone, email };
  const values = () => ({ dob: dob.value, gender: gender.value, notes: notes.value,
    parent: { name: name.value, relationship: relationship.value, phone: phone.value, email: email.value, consent: consent.checked } });

  let timer;
  const autosave = () => {
    clearTimeout(timer);
    saved.textContent = 'Saving…';
    timer = setTimeout(async () => {
      try { await call('', 'PUT', values()); saved.textContent = 'All changes saved'; } catch (e) { saved.textContent = `Not saved: ${e.message}`; }
    }, 600);
  };
  for (const el of [...Object.values(fields), notes, consent]) el.addEventListener('input', autosave);

  const form = h('form', { class: 'login', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    clearTimeout(timer);
    msg.textContent = '';
    for (const el of Object.values(fields)) el.removeAttribute('aria-invalid');
    try {
      await call('/submit', 'POST', values());
      saved.textContent = '';
      banner.textContent = 'Submitted. Thank you! You will hear from us about the next step. You can still update anything below and press Submit again.';
      banner.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (ex) {
      msg.textContent = ex.message;
      for (const k of ex.missing ?? []) fields[k]?.setAttribute('aria-invalid', 'true');
    }
  } },
    h('h3', {}, 'Your child'),
    h('label', {}, 'Name', h('input', { value: `${d.child.first_name} ${d.child.last_name}`, readonly: true })),
    required('Date of birth', dob), required('Gender', gender),
    h('label', {}, 'Anything we should know (optional)', notes),
    h('h3', {}, 'Parent / guardian'),
    required('Your name', name), required('Relationship to child', relationship),
    required('Mobile phone (for text prompts)', phone), required('Email', email),
    h('label', { class: 'check' }, consent, ' I agree to receive text messages about my child\u2019s goals. *'),
    h('p', { class: 'muted' }, '* Required'),
    h('button', { type: 'submit' }, 'Submit'), ' ', saved, msg);

  document.title = `Profile for ${d.child.first_name} - BTB`;
  app.replaceChildren(
    h('h2', {}, `Profile for ${d.child.first_name} ${d.child.last_name}`),
    h('p', { class: 'muted' }, `Please fill in the details below and press Submit. ${d.clinician || 'Your behavior analyst'} will contact you about the next step. What you enter is saved as you go.`),
    banner, form);
}
