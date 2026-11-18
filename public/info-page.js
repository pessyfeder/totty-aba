// Online new-client intake form (public page, /intake): one general form for every family. It follows the BTB paper packet, section by section.
// Answers are kept in this browser while the parent types, so a half-filled form survives a reload; Submit sends it to the app,
// which creates the client. The page shown afterwards carries the consultation booking link.
const GENDERS = ['Male', 'Female', 'Other'];
const STATES = [['NJ', 'New Jersey'], ['NY', 'New York']];

const CONSENT_ITEMS = [
  'Services provided by The BTB Method are parent/caregiver/educator-focused behavioral guidance, delivered by a licensed Behavior Analyst (BCBA/LBA). Services are provided directly to me as the parent/caregiver/educator, not as direct treatment to my child.',
  'Participation is voluntary. I may pause or stop services at any time, for any reason.',
  'Information I share is kept confidential, except where disclosure is required by law (for example, under mandatory reporting requirements, or where there is danger to self or others).',
  'No outcome, result, or timeline is guaranteed. Progress depends on many factors, including consistency of implementation across home, school and community. Think of it like any other ongoing treatment — a weekly visit to a therapist, or a medication taken exactly as prescribed: here, the strategies are the “prescription,” and they only work when applied consistently and precisely.',
  'I am responsible for my child’s safety and supervision at all times; guidance does not replace direct supervision.',
  'Fees, cancellation terms, and session logistics are described in the Fee & Cancellation Policy section of this form, which I have read.',
];
const NJ_ITEMS = [
  'I confirm that I will be physically located in New Jersey during each telepractice session with The BTB Method.',
  'I confirm that my child’s primary residence, and the place where I will apply the strategies discussed in sessions, is in New Jersey.',
  'I understand The BTB Method’s services are authorized only when both the session and the implementation of strategies take place in New Jersey.',
  'I agree to notify The BTB Method immediately — before the next session — if this changes for any reason (travel, relocation, a temporary stay in New York, or otherwise), so services can be paused or adjusted.',
  'I understand this attestation is required under New Jersey and New York professional licensing regulations, and that inaccurate information may affect my ability to continue receiving services.',
];
const NY_ITEMS = [
  'I confirm that my child has been diagnosed with autism spectrum disorder (or a related disorder, such as Asperger’s Syndrome, Rett Syndrome, Pervasive Developmental Disorder, or Childhood Disintegrative Disorder) by a licensed or otherwise authorized provider.',
  'I confirm that a written prescription or order for behavioral treatment has been issued for my child by a person licensed or authorized to provide such diagnosis and order.',
  'I will provide The BTB Method with a copy of the diagnosis and the order before the first session, or attach a copy to this form.',
  'I understand The BTB Method must keep this documentation on file, and that services cannot begin or continue in New York without it.',
  'I agree to notify The BTB Method promptly if this diagnosis or order is updated, withdrawn, or expires.',
];

const DRAFT = 'btb-intake-draft';
const readDraft = () => { try { return JSON.parse(localStorage.getItem(DRAFT)) ?? {}; } catch { return {}; } };

export async function renderInfoPage({ h, app }) {
  const call = async (path, method, body) => {
    const res = await fetch(`/intake-api${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error ?? `Request failed (${res.status})`), { missing: data.missing });
    return data;
  };
  const f = readDraft();
  const els = {}; // key -> input element, for reading values and flagging missing ones
  const saved = h('span', { class: 'muted', role: 'status' });
  const msg = h('p', { class: 'error', role: 'alert' });
    const today = new Date().toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });

  const autosave = () => {
    try { localStorage.setItem(DRAFT, JSON.stringify(values())); saved.textContent = 'Draft kept on this device'; } catch { saved.textContent = ''; }
  };
  const reg = (key, el, kind = 'value') => {
    els[key] = el;
    if (kind === 'checked') el.checked = Boolean(f[key]); else if (el.tagName !== 'SELECT' || f[key]) el.value = f[key] ?? '';
    el.addEventListener('input', () => { el.removeAttribute('aria-invalid'); autosave(); });
    return el;
  };
  const values = () => Object.fromEntries(Object.entries(els).map(([k, el]) => [k, el.type === 'checkbox' ? el.checked : el.value]));

  // ---- Field builders ----
  const star = (req) => (req ? ' *' : '');
  const text = (key, label, o = {}) => h('label', { class: o.wide ? 'wide' : '' }, label + star(o.req),
    reg(key, h('input', { name: key, type: o.type ?? 'text', required: o.req, autocomplete: o.auto, placeholder: o.ph, maxlength: o.max, max: o.type === 'date' && o.past ? new Date().toISOString().slice(0, 10) : undefined })));
  const area = (key, label, rows = 3) => h('label', { class: 'wide' }, label, reg(key, h('textarea', { name: key, rows })));
  const select = (key, label, options, o = {}) => h('label', {}, label + star(o.req),
    reg(key, h('select', { name: key, required: o.req }, h('option', { value: '' }, 'Select…'), options.map(([v, t]) => h('option', { value: v }, t)))));
  const check = (key, label) => h('label', { class: 'check' }, reg(key, h('input', { type: 'checkbox', name: key }), 'checked'), ' ', label);
  const radios = (key, options) => {
    const group = h('div', { class: 'radios', role: 'radiogroup' });
    const inputs = options.map(([v, t]) => {
      const r = h('input', { type: 'radio', name: key, value: v });
      r.checked = f[key] === v;
      r.addEventListener('change', () => { group.removeAttribute('aria-invalid'); autosave(); });
      group.append(h('label', { class: 'check' }, r, ' ', t));
      return r;
    });
    els[key] = { get value() { return inputs.find((r) => r.checked)?.value ?? ''; }, removeAttribute: (a) => group.removeAttribute(a), setAttribute: (a, v) => group.setAttribute(a, v), type: 'radio-group' };
    return group;
  };
  const signature = (key, label) => {
        return h('div', { class: 'sig' },
      h('label', { class: 'wide' }, `${label} *`, reg(key, h('input', { name: key, class: 'sig-input', autocomplete: 'off', placeholder: 'Type your full name to sign' }))),
      h('p', { class: 'muted' }, 'Typing your name is your electronic signature. Date: ', h('span', {}, today), '. Printed name and relationship are taken from the information above.'));
  };
  const initialsList = (items, prefix) => h('ol', { class: 'statements' }, items.map((t, i) => {
    const key = `${prefix}_i${i + 1}`;
    return h('li', {}, reg(key, h('input', { name: key, class: 'initial', maxlength: 6, autocomplete: 'off', placeholder: 'Initial', 'aria-label': `Your initials for statement ${i + 1}` })), h('span', {}, t));
  }));
  const numbered = (items) => h('ol', { class: 'statements plain' }, items.map((t) => h('li', {}, h('span', {}, t))));
  const section = (title, sub, ...kids) => h('section', { class: 'card intake-sec' }, h('h3', {}, title), sub ? h('p', { class: 'muted' }, sub) : false, ...kids);
  const grid = (...kids) => h('div', { class: 'row2' }, ...kids);

  // ---- Location & Eligibility: the section follows the state chosen in the address ----
  const stateSel = select('state', 'State', STATES, { req: true });
  const njBox = h('div', {},
    h('p', { class: 'muted' }, 'New Jersey and New York regulate behavior-analytic services differently. For New Jersey families, The BTB Method is authorized to provide services only when both the session and your child’s home environment are located in New Jersey. Please read and initial each statement.'),
    initialsList(NJ_ITEMS, 'nj'));
  const nyBox = h('div', {},
    grid(text('ny_provider', 'Diagnosing / ordering provider', { req: true }), text('ny_license', 'License type & state'),
      text('ny_provider_phone', 'Provider phone / contact', { type: 'tel' }), text('ny_dx_date', 'Date of diagnosis', { type: 'date', past: true })),
    h('p', { class: 'muted' }, 'Under New York Education Law Article 167, The BTB Method may provide services to a family located in New York only when the child has been diagnosed with autism spectrum disorder or a related disorder, and a prescription or order for behavioral treatment has been issued by a person licensed or otherwise authorized to provide that diagnosis and order. This form verifies and documents that eligibility. Required before services begin for New York families.'),
    initialsList(NY_ITEMS, 'ny'));
  const locPick = h('p', { class: 'muted' }, 'Choose your state under “Parent / Guardian” above to see the form for your family.');
  const syncState = () => {
    const s = els.state.value;
    njBox.hidden = s !== 'NJ'; nyBox.hidden = s !== 'NY'; locPick.hidden = Boolean(s);
    locSig.hidden = !s;
  };
  const locSig = signature('loc_sig', 'Parent / Caregiver / Educator signature');
  stateSel.querySelector('select').addEventListener('change', syncState);

  const submitBtn = h('button', { type: 'submit' }, 'Submit');
  const form = h('form', { class: 'intake', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    msg.textContent = '';
    for (const el of Object.values(els)) el.removeAttribute('aria-invalid');
    try {
      submitBtn.disabled = true; // one click, one client
      const { booking_url: bookingUrl } = await call('/submit', 'POST', { form: values() });
      try { localStorage.removeItem(DRAFT); } catch { /* no storage: nothing to clear */ }
      document.title = 'Intake form submitted - BTB';
      app.replaceChildren(h('h2', {}, 'Thank you!'),
        h('p', {}, 'Your intake form was received.'),
        bookingUrl
          ? h('p', {}, 'The next step is an initial consultation. ', h('a', { href: bookingUrl, class: 'button', rel: 'noopener' }, 'Schedule your consultation'))
          : h('p', {}, 'You will hear from us about scheduling your initial consultation.'));
      window.scrollTo({ top: 0 });
    } catch (ex) {
      submitBtn.disabled = false;
      msg.textContent = ex.message;
      const bad = (ex.missing ?? []).map((k) => els[k]).filter(Boolean);
      for (const el of bad) el.setAttribute('aria-invalid', 'true');
      msg.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  } },

    section('1. Client & Family Information', 'Please complete before your first session.',
      grid(text('child_first_name', "Child’s first name", { req: true }), text('child_last_name', "Child’s last name", { req: true }),
        text('dob', 'Date of birth', { type: 'date', req: true, past: true }),
        select('gender', 'Gender', GENDERS.map((g) => [g, g]), { req: true })),
      h('h4', {}, 'Parent / Guardian'),
      grid(text('parent_name', 'Full name', { req: true, auto: 'name' }), text('parent_relationship', 'Relationship to child', { req: true, ph: 'e.g. Mother' }),
        text('street', 'Street address', { req: true, auto: 'street-address', wide: true }),
        text('city', 'City', { req: true, auto: 'address-level2' }), stateSel, text('zip', 'Zip', { req: true, auto: 'postal-code', max: 10 }),
        text('phone', 'Mobile phone', { type: 'tel', req: true, auto: 'tel', ph: '(555) 555-0123' }), text('email', 'Email', { type: 'email', req: true, auto: 'email' })),
      h('h4', {}, 'Preferred contact method (check all that apply)'),
      h('div', { class: 'checks' }, check('pref_text', 'Text'), check('pref_email', 'Email'), check('pref_call', 'Phone call')),
      h('h4', {}, 'Second parent / caregiver (optional)'),
      grid(text('p2_name', 'Full name'), text('p2_relationship', 'Relationship to child'),
        text('p2_phone', 'Mobile phone', { type: 'tel', ph: '(555) 555-0123' }), text('p2_email', 'Email', { type: 'email' })),
      h('h4', {}, 'Preferred contact method (check all that apply)'),
      h('div', { class: 'checks' }, check('p2_pref_text', 'Text'), check('p2_pref_email', 'Email'), check('p2_pref_call', 'Phone call'))),

    section('2. Communication Preferences', null,
      grid(text('language', 'Language', { ph: 'e.g. English' }))),

    section('3. Informed Consent for Services', 'To be signed before services begin. By signing below, I understand and agree to the following:',
      numbered(CONSENT_ITEMS),
      check('consent_ack', 'I have read and agree to all of the statements above. *'),
      signature('consent_sig', 'Parent / Caregiver / Educator signature')),

    section('4. Fee & Cancellation Policy', 'Private pay · No insurance billing',
      h('table', { class: 'rates' },
        h('tr', {}, h('td', {}, 'First Session (Intake)'), h('td', {}, '$275')),
        h('tr', {}, h('td', {}, 'Standard Session'), h('td', {}, '$175')),
        h('tr', {}, h('td', {}, 'In-Vivo Observation Session (live guidance by video call while you implement strategies with your child across home, school and community)'), h('td', {}, '$325'))),
      h('h4', {}, 'Payment method(s) accepted'),
      h('p', {}, 'Credit card on file (preferred); Zelle or cash also accepted.'),
      h('h4', {}, 'Payment due'),
      radios('pay_due', [['session', 'At time of session'], ['other', 'Other (specify below)']]),
      text('pay_other', 'If other, please specify', { wide: true }),
      h('h4', {}, 'Receipts'),
      h('p', {}, 'Superbills/receipts are provided upon request for families seeking reimbursement or using an FSA/HSA. The BTB Method does not bill insurance directly.'),
      h('h4', {}, 'Cancellation policy'),
      h('p', {}, 'Please give at least 48 hours’ notice to cancel or reschedule a session. Late cancellations or no-shows may be charged the full session rate.'),
      h('h4', {}, 'Billing questions'),
      h('p', {}, h('a', { href: 'mailto:Office@TheBTBMethod.com' }, 'Office@TheBTBMethod.com')),
      h('p', { class: 'muted' }, 'Credit card details are not collected on this page. The BTB Method will arrange your card on file with you directly.'),
      check('fee_ack', 'I have read and agree to the Fee & Cancellation Policy. *')),

    section('5. Background & History', 'Please complete before your first session.',
      area('diagnoses', 'Current diagnoses (if any)'), area('medications', 'Current medications'),
      area('providers', 'Current providers / other services (school, OT, speech, other therapy)'),
      area('past_interventions', 'Past interventions tried for this behavior'),
      area('implementers', 'Family members / caregivers involved in implementing strategies'),
      area('anything_else', 'Anything else we should know')),

    section('6. Preference Assessment — What Motivates Your Child', 'List your child’s favorites in each category below, then choose the top 3 overall.',
      area('fav_toys', 'Toys & Activities', 2), area('fav_foods', 'Foods & Snacks', 2),
      area('fav_social', 'Social / Attention (praise, tickles, high-fives)', 2), area('fav_sensory', 'Sensory (music, movement, textures)', 2),
      area('fav_screen', 'Screen Time / Technology', 2), area('fav_other', 'Other', 2),
      h('h4', {}, 'Top 3 overall (ranked)'),
      text('top1', '1.', { wide: true }), text('top2', '2.', { wide: true }), text('top3', '3.', { wide: true })),

    section('7. Crisis & Emergency Response', 'What to do if H.O.P. happens',
      numbered([
        'Ensure immediate physical safety first. If you can safely do so, remove your child or others from danger.',
        'If there is serious risk to life or safety, call 911 (or your local emergency number) right away. Do not wait to contact The BTB Method first.',
        'Once safe, contact The BTB Method at (718) 344-6806 or Office@TheBTBMethod.com to let us know what happened, so we can review and adjust the plan together.',
        'Write down what happened as soon as you can, while it’s fresh. This helps us adjust the plan.']),
      h('p', {}, h('strong', {}, 'H.O.P. means danger to: '), 'H — Him / Herself · O — Others · P — Property. Otherwise — no emergency response needed. Just record it, as always.'),
      h('p', {}, h('em', {}, '“Hop in — only when there’s H.O.P.”')),
      check('crisis_ack', 'I have read the Crisis & Emergency Response sheet. *')),

    section('8. Release of Information (optional)', 'Complete only if you’d like The BTB Method to communicate directly with another provider involved in your child’s care (for example, a school, pediatrician, or therapist).',
      h('h4', {}, 'Authorize The BTB Method to'),
      radios('roi_direction', [['share', 'Share information with'], ['receive', 'Receive information from'], ['both', 'Both']]),
      text('roi_provider', 'Provider / organization name', { wide: true }), text('roi_contact', 'Contact info (phone / email)', { wide: true }),
      text('roi_info', 'Type of information to be shared', { wide: true }),
      text('roi_until', 'This authorization is valid until (date), or until revoked in writing', { type: 'date', wide: true }),
      signature('roi_sig', 'Parent / Caregiver / Educator signature (only if completing this section)')),

    section('9. Telepractice Location & Eligibility', 'Complete the part for your state, initial each item, and sign.',
      locPick, njBox, nyBox, locSig),

    h('p', { class: 'muted' }, '* Required'),
    h('div', {}, submitBtn, ' ', saved), msg);

  syncState();

  document.title = 'New client intake form - BTB';
  app.replaceChildren(
    h('h2', {}, 'New client intake form'),
    h('p', { class: 'muted' }, 'Please fill in the sections below and press Submit at the end. We will contact you about the next step. What you type is kept on this device while you work, so you can come back to this page if you need to stop.'),
    form);
}
