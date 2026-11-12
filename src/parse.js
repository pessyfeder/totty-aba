// Parent reply parsing (SPEC 5.4).
// "Goal 2" prefix selects a prompt by its short code. Then:
//   yes_no:   Y / YES / N / NO, case-insensitive
//   duration: whole number of minutes, 0-1440, optional trailing "min"/"minutes"
// Extra text after the answer is ignored; replies never carry comments.

const CODE = /^\s*goal\s*#?\s*(\d+)\b[\s:.\-]*/i;
export const MAX_MINUTES = 1440;

export function extractCode(text) {
  const m = CODE.exec(text ?? '');
  return m ? { code: Number(m[1]), rest: text.slice(m[0].length) } : { code: null, rest: text ?? '' };
}

/** @returns {{ok: true, valueBool?: boolean, valueMinutes?: number} | {ok: false}} */
export function parseReply(text, responseType) {
  const t = (text ?? '').trim();
  if (responseType === 'yes_no') {
    const m = /^(y|yes|n|no)\b/i.exec(t);
    return m ? { ok: true, valueBool: m[1].toLowerCase().startsWith('y') } : { ok: false };
  }
  if (responseType === 'duration') {
    const m = /^(\d{1,4})(?![0-9.])\s*(?:min(?:ute)?s?\b)?/i.exec(t);
    if (!m || Number(m[1]) > MAX_MINUTES) return { ok: false };
    return { ok: true, valueMinutes: Number(m[1]) };
  }
  return { ok: false };
}
