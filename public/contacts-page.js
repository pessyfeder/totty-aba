// Contacts pane (SPEC 5.1): add and edit the parent/caregiver contact details for one client.
// Kept on its own page so contact details are not edited by accident from the goals view.
const STATUS = { active: 'Active', paused: 'Paused (no prompts)', ended: 'Ended' };

/** One form for both adding (p == null) and editing. Editing sends every field so cleared fields are cleared. onSaved runs after a successful save. */
export function contactForm({ h, api }, clientId, p, onSaved) {
  const lbl = (text, input) => h('label', {}, text, input);
  const phoneAttrs = { name: 'phone', type: 'tel', pattern: '\\+[1-9][0-9]{6,14}', title: 'International format, e.g. +15551234567' };

  {
    const msg = h('span', { class: 'error', role: 'alert' });
    const val = (k) => p?.[k] ?? '';
    const consent = h('input', { name: 'consent', type: 'checkbox', checked: Boolean(p?.consent_given_at) });
    const form = h('form', { class: 'contact-form', onsubmit: async (e) => {
      e.preventDefault();
      msg.textContent = '';
      const f = new FormData(form);
      const t = (k) => String(f.get(k) ?? '').trim() || null;
      const body = {
        name: t('name'), relationship: t('relationship'), phone: t('phone'), email: t('email'),
        language: t('language') ?? 'en', preferred_channel: f.get('preferred_channel'), consent_note: t('consent_note'),
        // Keep the original consent date while consent stays ticked; record now when newly ticked.
        consent_given_at: consent.checked ? (p?.consent_given_at ?? new Date().toISOString()) : null,
      };
      if (p) body.status = f.get('status');
      try {
        if (p) await api(`/contacts/${p.id}`, { method: 'PATCH', body });
        else await api(`/clients/${clientId}/contacts`, { method: 'POST', body });
        await onSaved();
      } catch (ex) { msg.textContent = ex.message; }
    } },
      lbl('Name', h('input', { name: 'name', value: val('name'), required: true })),
      lbl('Relationship', h('input', { name: 'relationship', value: val('relationship'), placeholder: 'Mother' })),
      lbl('Mobile (+15551234567)', h('input', { ...phoneAttrs, value: val('phone') })),
      lbl('Email', h('input', { name: 'email', type: 'email', value: val('email') })),
      lbl('Preferred channel', h('select', { name: 'preferred_channel' },
        ['sms', 'call'].map((v) => h('option', { value: v, selected: (p?.preferred_channel ?? 'sms') === v }, v === 'sms' ? 'Text message' : 'Voice call')))),
      lbl('Language', h('input', { name: 'language', value: val('language') || 'en' })),
      p && lbl('Status', h('select', { name: 'status' }, Object.entries(STATUS).map(([v, t]) => h('option', { value: v, selected: p.status === v }, t)))),
      h('label', {}, consent, ` Parent consented to texts/calls${p?.consent_given_at ? ` (since ${String(p.consent_given_at).slice(0, 10)})` : ''}`),
      lbl('Consent note', h('input', { name: 'consent_note', value: val('consent_note'), placeholder: 'e.g. signed form on file' })),
      h('button', { type: 'submit' }, p ? 'Save changes' : 'Add contact'), msg);
    return form;
  }
}

export async function renderContacts({ h, api, app, logoutBtn, handle }, clientId) {
  const c = await api(`/clients/${clientId}`);
  logoutBtn.hidden = false;
  const reload = () => renderContacts({ h, api, app, logoutBtn, handle }, clientId).catch(handle);
  const contactForm_ = (p) => contactForm({ h, api }, clientId, p, reload);

  app.replaceChildren(
    h('p', {}, h('a', { href: `#/client/${clientId}` }, `← ${c.first_name} ${c.last_name}`)),
    h('h2', {}, 'Contacts'),
    h('p', { class: 'muted' }, 'Pausing or ending a contact stops all prompts to that person.'),
    ...c.contacts.map((p) => h('details', { class: 'card goal-card', open: c.contacts.length === 1 },
      h('summary', {}, `${p.name}${p.relationship ? ` (${p.relationship})` : ''} — ${STATUS[p.status] ?? p.status}`), contactForm_(p))),
    h('h2', {}, 'Add a contact'),
    h('div', { class: 'card' }, contactForm_(null)));
}
