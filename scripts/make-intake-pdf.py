"""Builds the printable PDF version of the online intake form (public/info-page.js).
Run: python scripts/make-intake-pdf.py   -> btb-docs/BTB_New_Client_Intake_Form.pdf
Keep the wording in sync with public/info-page.js."""
import re, pathlib
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph, KeepTogether, Spacer, Table, TableStyle,
                                PageBreak, KeepTogether, Flowable)

ROOT = pathlib.Path(__file__).resolve().parent.parent
src = (ROOT / 'public' / 'info-page.js').read_text(encoding='utf-8')

def js_list(name):  # pull the string arrays straight from the web form so the two never drift
    body = re.search(r'const %s = \[(.*?)\n\];' % name, src, re.S).group(1)
    return [m.replace("\\'", "'") for m in re.findall(r"^\s*'(.*)',\s*$", body, re.M)]
def js_const(name):
    return re.search(r"const %s = '(.*)';" % name, src).group(1)

CONSENT, NJ, NY, TEXT = js_list('CONSENT_ITEMS'), js_list('NJ_ITEMS'), js_list('NY_ITEMS'), js_const('TEXT_CONSENT')
ACC = colors.HexColor('#2f5d62')
W = letter[0] - 1.5 * inch

base = ParagraphStyle('b', fontName='Helvetica', fontSize=9.5, leading=12.5)
small = ParagraphStyle('s', parent=base, fontSize=8.5, leading=11, textColor=colors.HexColor('#444444'))
h1 = ParagraphStyle('h1', parent=base, fontName='Helvetica-Bold', fontSize=20, leading=24, textColor=ACC)
h2 = ParagraphStyle('h2', parent=base, fontName='Helvetica-Bold', fontSize=12.5, leading=16, textColor=colors.white, backColor=ACC, borderPadding=(3, 5, 3, 5), spaceBefore=12, spaceAfter=8)
h3 = ParagraphStyle('h3', parent=base, fontName='Helvetica-Bold', fontSize=10, spaceBefore=7, spaceAfter=3, textColor=ACC)

class Line(Flowable):
    """A fill-in field: label followed by a ruled line."""
    def __init__(self, label, width=W, height=20):
        super().__init__(); self.label, self.w, self.h = label, width, height
    def wrap(self, *_): return self.w, self.h
    def draw(self):
        c = self.canv; c.setFont('Helvetica', 8.5); c.setFillColor(colors.HexColor('#333333'))
        c.drawString(0, 5, self.label)
        x = c.stringWidth(self.label, 'Helvetica', 8.5) + 4
        c.setStrokeColor(colors.HexColor('#666666')); c.setLineWidth(0.5); c.line(x, 3, self.w, 3)

class Box(Flowable):
    """An empty writing box with a caption above."""
    def __init__(self, label, height=48):
        super().__init__(); self.label, self.bh = label, height
    def wrap(self, *_): return W, self.bh + 14
    def draw(self):
        c = self.canv; c.setFont('Helvetica', 8.5); c.setFillColor(colors.HexColor('#333333'))
        c.drawString(0, self.bh + 4, self.label)
        c.setStrokeColor(colors.HexColor('#666666')); c.setLineWidth(0.5); c.rect(0, 0, W, self.bh)

def row(*labels):
    n = len(labels); gap = 14; cw = (W - gap * (n - 1)) / n
    cells = []
    for i, l in enumerate(labels):
        cells += [Line(l, cw)] + ([''] if i < n - 1 else [])
    t = Table([cells], colWidths=sum(([cw, gap] for _ in range(n - 1)), []) + [cw])
    t.setStyle(TableStyle([('LEFTPADDING', (0, 0), (-1, -1), 0), ('RIGHTPADDING', (0, 0), (-1, -1), 0), ('TOPPADDING', (0, 0), (-1, -1), 0), ('BOTTOMPADDING', (0, 0), (-1, -1), 0)]))
    return t

def checks(label, options):
    return Paragraph(f'{label} ' + '&nbsp;&nbsp;'.join(f'[&nbsp;&nbsp;] {o}' for o in options), base)

def check_item(text):
    t = Table([[Paragraph('[&nbsp;&nbsp;]', base), Paragraph(text, base)]], colWidths=[0.38 * inch, W - 0.38 * inch])
    t.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP'), ('LEFTPADDING', (0, 0), (-1, -1), 0), ('TOPPADDING', (0, 0), (-1, -1), 2), ('BOTTOMPADDING', (0, 0), (-1, -1), 2)]))
    return t

def initialled(items):
    out = []
    for i, text in enumerate(items, 1):
        t = Table([[Paragraph('_______', base), Paragraph(f'{i}. {text}', base)]], colWidths=[0.65 * inch, W - 0.65 * inch])
        t.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP'), ('LEFTPADDING', (0, 0), (-1, -1), 0), ('TOPPADDING', (0, 0), (-1, -1), 2), ('BOTTOMPADDING', (0, 0), (-1, -1), 3)]))
        out.append(t)
    return out

def sig(label):
    return [Spacer(1, 6), Line(label + ':'), Line('Date:', W / 3), Spacer(1, 2)]

def sec(title, sub=None):
    return [Paragraph(title, h2)] + ([Paragraph(sub, small), Spacer(1, 4)] if sub else [])

class BTBIcon(Flowable):  # the BTB Method icon (same design as the website logo in btb-docs/index.html)
    def __init__(self, size=64):
        super().__init__(); self.size = self.width = self.height = size
    def draw(self):
        c, k = self.canv, self.size / 100.0
        c.saveState(); c.scale(k, k)
        c.setFillColor(colors.HexColor('#1F3A66')); c.roundRect(0, 0, 100, 100, 9, stroke=0, fill=1)
        c.setFillColor(colors.HexColor('#E23A30')); c.setFont('Times-Bold', 37); c.drawCentredString(50.4, 45, 'BTB')
        c.setFillColor(colors.white); c.setFont('Helvetica-Bold', 8.2); c.drawCentredString(50.9, 29.5, 'T H E   M E T H O D')
        c.setFont('Helvetica-Bold', 11); c.drawRightString(92.5, 78, 'TM')
        c.restoreState()

head = Table([[BTBIcon(64), [Paragraph('New Client Intake Form', h1), Paragraph('The BTB Method', ParagraphStyle('t', parent=base, fontSize=11, textColor=ACC))]]],
             colWidths=[64 + 14, W - 78], style=TableStyle([('VALIGN', (0, 0), (-1, -1), 'MIDDLE'), ('LEFTPADDING', (0, 0), (-1, -1), 0), ('TOPPADDING', (0, 0), (-1, -1), 0), ('BOTTOMPADDING', (0, 0), (-1, -1), 0)]))
s = []
s += [head, Spacer(1, 8),
      Paragraph('<b>In order to schedule a consultation, first complete this intake form.</b> Please fill in the sections below and return it to Office@TheBTBMethod.com. Fields marked * are required.', base)]

s += sec('1. Client &amp; Family Information', 'Please complete before your first session.')
s += [row('Child’s first name *', 'Child’s last name *'), row('Date of birth *', 'Gender *   [  ] Male   [  ] Female'),
      Paragraph('Parent / Caregiver', h3),
      row('Full name *', 'Relationship to child *'), row('Street address *'), row('City *', 'State *  [  ] NJ  [  ] NY', 'Zip *'),
      row('Mobile phone *', 'Email *'), row('Preferred language'),
      Spacer(1, 4), checks('Preferred contact method (check all that apply):', ['Text', 'Email', 'Phone call']), Spacer(1, 3), check_item(TEXT),
      Paragraph('Second parent / caregiver (optional)', h3),
      row('Full name', 'Relationship to child'), row('Mobile phone', 'Email'),
      Spacer(1, 4), checks('Preferred contact method (check all that apply):', ['Text', 'Email', 'Phone call']), Spacer(1, 3), check_item(TEXT)]

s += [PageBreak()] + sec('2. Informed Consent for Services', 'To be signed before services begin. By signing below, I understand and agree to the following:')
s += [Paragraph(f'{i}. {t}', ParagraphStyle('n', parent=base, leftIndent=14, firstLineIndent=-14, spaceAfter=3)) for i, t in enumerate(CONSENT, 1)]
s += [Spacer(1, 3), check_item('I have read and agree to all of the statements above. *')] + sig('Parent / Caregiver / Educator signature *')

fee = Table([['First Session (Intake)', '$275'], ['Standard Session', '$175'],
             [Paragraph('In-Vivo Observation Session (live guidance by video call while you implement strategies with your child across home, school and community)', base), '$325']],
            colWidths=[W - 0.9 * inch, 0.9 * inch])
fee.setStyle(TableStyle([('FONT', (0, 0), (-1, -1), 'Helvetica', 9.5), ('ALIGN', (1, 0), (1, -1), 'RIGHT'), ('VALIGN', (0, 0), (-1, -1), 'TOP'), ('LINEBELOW', (0, 0), (-1, -1), 0.4, colors.HexColor('#bbbbbb'))]))
s += [KeepTogether(sec('3. Fee &amp; Cancellation Policy', 'Private pay · No insurance billing') + [fee,
      Paragraph('Payment method(s) accepted', h3), Paragraph('Credit card on file (preferred); Zelle or cash also accepted.', base), Spacer(1, 2), Paragraph('Payment due upon scheduling appointment.', base),
      Paragraph('Receipts', h3), Paragraph('Superbills/receipts are provided upon request for families seeking reimbursement or using an FSA/HSA. The BTB Method does not bill insurance directly.', base),
      Paragraph('Cancellation policy', h3), Paragraph('Please give at least 48 hours’ notice to cancel or reschedule a session. Late cancellations or no-shows may be charged the full session rate.', base),
      Paragraph('Billing questions', h3), Paragraph('Office@TheBTBMethod.com', base), Spacer(1, 3),
      Paragraph('Please do not write credit card details on this form. To put a credit card on file, use The BTB Method’s secure credit card processing portal.', small), Spacer(1, 5),
      check_item('I have read and agree to the Fee &amp; Cancellation Policy. *')])]

s += [PageBreak()] + sec('4. Background &amp; History', 'Please complete before your first session.')
for l in ['Current diagnoses (if any)', 'Current medications', 'Current providers / other services (school, OT, speech, other therapy)',
          'Past interventions tried for this behavior', 'Family members / caregivers involved in implementing strategies', 'Anything else we should know']:
    s.append(Box(l, 46))

s += [PageBreak()] + sec('5. Preference Assessment — What Motivates Your Child', 'List your child’s favorites in each category below, then choose the top 3 overall.')
for l in ['Toys & Activities', 'Foods & Snacks', 'Social / Attention (praise, tickles, high-fives)', 'Sensory (music, movement, textures)', 'Screen Time / Technology', 'Other']:
    s.append(Box(l, 38))
s += [Paragraph('Top 3 overall (ranked)', h3), Line('1.'), Line('2.'), Line('3.')]

s += [KeepTogether(sec('6. Release of Information (optional)', 'Complete only if you’d like The BTB Method to communicate directly with another provider involved in your child’s care (for example, a school, pediatrician, or therapist).') + [
      Paragraph('Authorize The BTB Method to', h3), Paragraph('[ ] Share information with &nbsp;&nbsp; [ ] Receive information from &nbsp;&nbsp; [ ] Both', base), Spacer(1, 4),
      Line('Provider / organization name:'), Line('Contact info (phone / email):'), Line('Type of information to be shared:'),
      Line('This authorization is valid until (date), or until revoked in writing:')] + sig('Parent / Caregiver / Educator signature (only if completing this section)'))]

def esig():
    return [Spacer(1, 6), Line('Parent / Caregiver / Educator Signature *:'), row('Printed Name *', 'Relationship to Child *'), Spacer(1, 6)]
COPY = Paragraph('© 2026 The BTB Method. Confidential — for use by families enrolled with The BTB Method. Not for reproduction or distribution.', small)

s += [PageBreak()] + sec('7. Telepractice Location &amp; Eligibility Form', 'Please complete ONLY the section for your state, initial each item, and sign.')
s += [row('Child’s Name *', 'Date *'), Spacer(1, 3),
      checks('My family is located in:', ['New Jersey (Section A)', 'New York (Section B, next page)'])]
s += [Paragraph('SECTION A  |  New Jersey Families — Location Attestation &amp; Consent', h3),
      Paragraph('New Jersey and New York regulate behavior-analytic services differently. For New Jersey families, The BTB Method is authorized to provide services only when both the session and your child’s home environment are located in New Jersey. Please read and initial each statement.', base), Spacer(1, 4)] + initialled(NJ)
s += esig()
s += [KeepTogether([Paragraph('For Practitioner Use Only', h3),
      row('Reviewed By (The BTB Method):', 'Date Reviewed:'), Line('Next Re-Verification Due:', W / 2)]), Spacer(1, 6), COPY]
s += [PageBreak(), Paragraph('SECTION B  |  New York Families — Diagnosis &amp; Treatment Order Verification', h3),
      Paragraph('Complete only if your family is located in New York.', small), Spacer(1, 3),
      row('Child’s Name *', 'Date *'),
      row('Diagnosing / Ordering Provider *', 'License Type & State'), row('Provider Phone / Contact', 'Date of Diagnosis'), Spacer(1, 4),
      Paragraph('Under New York Education Law Article 167, The BTB Method may provide services to a family located in New York only when the child has been diagnosed with autism spectrum disorder or a related disorder, and a prescription or order for behavioral treatment has been issued by a person licensed or otherwise authorized to provide that diagnosis and order. This form verifies and documents that eligibility. Required before services begin for New York families.', base), Spacer(1, 4)] + initialled(NY)
s += esig()
s += [KeepTogether([Paragraph('For Practitioner Use Only', h3),
      row('Reviewed By (The BTB Method):', 'Date Verified:'), Line('Diagnosis/Order Copy on File (Y/N):', W / 2)]),
      Spacer(1, 6), COPY, Spacer(1, 4), Paragraph('* Required', small)]

def footer(c, d):
    c.saveState(); c.setFillColor(colors.HexColor('#2f5d62')); c.setFillAlpha(0.08)  # diagonal watermark
    c.translate(letter[0] / 2, letter[1] / 2); c.rotate(45)
    c.setFont('Helvetica-Bold', 90); c.drawCentredString(0, 20, 'BTB')
    c.setFont('Helvetica-Bold', 30); c.drawCentredString(0, -30, 'Behavior Treating Behavior'); c.restoreState()
    c.saveState(); c.setFont('Helvetica', 8); c.setFillColor(colors.HexColor('#777777'))
    c.drawString(0.75 * inch, 0.45 * inch, 'The BTB Method · New Client Intake Form'); c.drawRightString(letter[0] - 0.75 * inch, 0.45 * inch, f'Page {d.page}')
    c.restoreState()

out = ROOT / 'btb-docs' / 'To Use' / 'BTB_New_Client_Intake_Form.pdf'
doc = BaseDocTemplate(str(out), pagesize=letter, leftMargin=0.75 * inch, rightMargin=0.75 * inch, topMargin=0.7 * inch, bottomMargin=0.8 * inch, title='New Client Intake Form - The BTB Method')
doc.addPageTemplates([PageTemplate(frames=[Frame(doc.leftMargin, doc.bottomMargin, W, letter[1] - doc.topMargin - doc.bottomMargin, id='f')], onPage=footer)])
doc.build(s)
print(out)
