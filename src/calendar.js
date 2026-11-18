// Appointment helpers (SPEC 5.7b).

/**
 * Which appointment page an appointment opens: the initial consultation, the first check-in (baseline review),
 * or a bi-weekly check-in. A client's first non-cancelled check-in is the baseline one; any other meeting is treated as bi-weekly.
 */
export function appointmentKind(type, earlierCheckins = 0) {
  if (type === 'consultation') return 'initial_consultation';
  if (type === 'check-in' && Number(earlierCheckins) === 0) return 'first_checkin';
  return 'biweekly_checkin';
}
