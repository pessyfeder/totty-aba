// The intake form is a fillable PDF (SPEC 5.1a, open question 0). Field names are fixed, so reading it needs no
// guessing of question wording. buildIntakeFormPdf() makes the blank form Totty emails; readPdfFields() reads a
// returned copy into the generic shape parseForm understands.
import { PDFDocument, PDFTextField, PDFDropdown, PDFRadioGroup, StandardFonts } from 'pdf-lib';

const CHILD_FIELDS = [
  ['first_name', "Child's first name"], ['last_name', "Child's last name"], ['dob', 'Date of birth (M/D/YYYY)'],
  ['gender', 'Gender'], ['location', 'City / location'],
];
const PARENT_FIELDS = [
  ['name', 'Full name'], ['relationship', 'Relationship to child'], ['phone', 'Mobile phone'], ['email', 'Email'],
];
const LANGUAGES = ['English', 'Yiddish', 'Hebrew', 'Spanish', 'Russian', 'French', 'Arabic'];
const CHANNELS = ['Text message', 'Phone call'];
export const PARENT_COUNT = 2;

/** The blank fillable form (Letter size, one page). */
export async function buildIntakeFormPdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const form = doc.getForm();
  let y = 750;
  const heading = (t) => { page.drawText(t, { x: 50, y, size: 13, font: bold }); y -= 22; };
  const text = (name, label, w = 300) => {
    page.drawText(label, { x: 50, y: y + 6, size: 10, font });
    form.createTextField(name).addToPage(page, { x: 230, y, width: w, height: 18, font });
    y -= 26;
  };
  const choice = (name, label, options) => {
    page.drawText(label, { x: 50, y: y + 6, size: 10, font });
    const d = form.createDropdown(name);
    d.addOptions(options);
    d.addToPage(page, { x: 230, y, width: 300, height: 18, font });
    y -= 26;
  };
  page.drawText('Client intake form', { x: 50, y, size: 18, font: bold }); y -= 36;
  heading('Child');
  for (const [k, label] of CHILD_FIELDS) text(k, label);
  for (let p = 1; p <= PARENT_COUNT; p++) {
    y -= 8;
    heading(p === 1 ? 'Parent / guardian' : 'Second parent / guardian (optional)');
    for (const [k, label] of PARENT_FIELDS) text(`parent${p}_${k}`, label);
    choice(`parent${p}_language`, 'Preferred language', LANGUAGES);
    choice(`parent${p}_preferred_channel`, 'Preferred contact', CHANNELS);
  }
  y -= 8;
  heading('Anything else we should know?');
  const notes = form.createTextField('notes');
  notes.enableMultiline();
  notes.addToPage(page, { x: 50, y: y - 70, width: 510, height: 80, font });
  return Buffer.from(await doc.save());
}

/**
 * Reads a filled copy into {first_name, ..., contacts: [{name, ...}]}, the JSON shape parseForm accepts.
 * Throws a user-facing Error for a PDF that is unreadable, protected, or has no form fields (flattened/scanned).
 */
export async function readPdfFields(buffer) {
  let doc;
  try { doc = await PDFDocument.load(buffer); } catch { throw new Error('The PDF could not be read (it may be damaged or password-protected)'); }
  const fields = doc.getForm().getFields();
  if (!fields.length) throw new Error('This PDF has no fillable fields. Upload the filled-in copy of the intake form, not a scan or printout');
  const v = {};
  for (const f of fields) {
    let val = '';
    if (f instanceof PDFTextField) val = f.getText() ?? '';
    else if (f instanceof PDFDropdown) val = f.getSelected()[0] ?? '';
    else if (f instanceof PDFRadioGroup) val = f.getSelected() ?? '';
    v[f.getName()] = val;
  }
  const out = {};
  for (const [k] of CHILD_FIELDS) out[k] = v[k] ?? '';
  out.notes = v.notes ?? '';
  out.contacts = [];
  for (let p = 1; p <= PARENT_COUNT; p++) {
    const c = {};
    for (const k of ['name', 'relationship', 'phone', 'email', 'language', 'preferred_channel']) c[k === 'name' ? 'parent_name' : k] = v[`parent${p}_${k}`] ?? '';
    if (Object.values(c).some((x) => String(x).trim())) out.contacts.push(c);
  }
  return out;
}
