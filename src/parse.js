// Parent reply parsing (SPEC 5.4).
// "Goal 2" prefix selects a prompt by its short code. Then:
//   yes_no: Y / YES / N / NO, case-insensitive
//   rating: 0-5 optionally followed by a comment, e.g. "3 tough day, needed help"

const CODE = /^\s*goal\s*#?\s*(\d+)\b[\s:.\-]*/i;

export function extractCode(text) {
  const m = CODE.exec(text ?? '');
  return m ? { code: Number(m[1]), rest: text.slice(m[0].length) } : { code: null, rest: text ?? '' };
}

/** @returns {{ok: true, valueBool?: boolean, valueInt?: number, comment: string|null} | {ok: false}} */
export function parseReply(text, responseType) {
  const t = (text ?? '').trim();
  if (responseType === 'yes_no') {
    const m = /^(y|yes|n|no)\b[\s.!,]*(.*)$/is.exec(t);
    if (!m) return { ok: false };
    return { ok: true, valueBool: m[1].toLowerCase().startsWith('y'), comment: m[2].trim() || null };
  }
  if (responseType === 'rating') {
    const m = /^([0-5])(?![0-9.])[\s.!,:\-]*(.*)$/s.exec(t);
    if (!m) return { ok: false };
    return { ok: true, valueInt: Number(m[1]), comment: m[2].trim() || null };
  }
  return { ok: false };
}
