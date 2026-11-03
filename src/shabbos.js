// Shabbos / Yom Tov no-send windows (SPEC 5.3).
// A window runs from candle lighting on the eve of a restricted day until nightfall at its end.
// Back-to-back restricted days (Yom Tov into Shabbos, two-day Yom Tov) merge into one window.
import { ComplexZmanimCalendar, GeoLocation, JewishCalendar, Luxon } from 'kosher-zmanim';

const { DateTime } = Luxon;
const DAY_RANGE = 5; // longest merged chain is well under this many days

/**
 * Build the location the calculator needs from a client/clinician row and the settings.
 * Per-client candle lighting overrides the clinician default.
 */
export function locationFrom(row, settings = {}) {
  // Fail closed: a missing location must never silently become (0, 0) and yield a wrong window.
  if (row.latitude == null || row.longitude == null || !row.timezone) {
    throw new Error('Location (latitude, longitude, timezone) is required to compute the Shabbos window');
  }
  return {
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    timezone: row.timezone,
    inIsrael: Boolean(row.in_israel),
    candleMinutes: row.candle_lighting_minutes ?? settings.candle_lighting_minutes_before_sunset ?? 18,
    nightfallMinutes: settings.nightfall_minutes_after_sunset ?? 72, // Rabbeinu Tam
  };
}

function sunsetOf(day, loc) {
  const geo = new GeoLocation('loc', loc.latitude, loc.longitude, 0, loc.timezone);
  const cal = new ComplexZmanimCalendar(geo);
  cal.setDate(day);
  return cal.getSunset();
}

/** 'shabbos' | 'yom_tov' if the local calendar day is a no-melacha day, else null. */
function restrictedKind(day, loc) {
  const jc = new JewishCalendar(day);
  jc.setInIsrael(loc.inIsrael);
  if (!jc.isAssurBemelacha()) return null;
  return jc.getDayOfWeek() === 7 ? 'shabbos' : 'yom_tov';
}

/** All merged windows overlapping [from, to], sorted by start. */
export function windowsBetween(from, to, loc) {
  const first = DateTime.fromJSDate(from, { zone: loc.timezone }).startOf('day');
  const last = DateTime.fromJSDate(to, { zone: loc.timezone }).startOf('day');
  const raw = [];
  for (let day = first.minus({ days: 1 }); day <= last.plus({ days: 1 }); day = day.plus({ days: 1 })) {
    const kind = restrictedKind(day, loc);
    if (!kind) continue;
    const eveSunset = sunsetOf(day.minus({ days: 1 }), loc);
    const endSunset = sunsetOf(day, loc);
    if (!eveSunset || !endSunset) continue; // no sunset (polar): not supported
    raw.push({
      start: eveSunset.minus({ minutes: loc.candleMinutes }).toJSDate(),
      end: endSunset.plus({ minutes: loc.nightfallMinutes }).toJSDate(),
      kinds: [kind],
    });
  }
  const merged = [];
  for (const w of raw) {
    const prev = merged[merged.length - 1];
    if (prev && w.start <= prev.end) {
      prev.end = new Date(Math.max(prev.end, w.end));
      prev.kinds.push(...w.kinds);
    } else merged.push({ ...w });
  }
  return merged.map((w) => ({
    start: w.start,
    end: w.end,
    kind: w.kinds.includes('yom_tov') ? 'yom_tov' : 'shabbos',
  }));
}

const span = (at) => [new Date(at.getTime() - DAY_RANGE * 864e5), new Date(at.getTime() + DAY_RANGE * 864e5)];

/** The window containing `at`, or null when sending/using the app is allowed. */
export function windowAt(at, loc) {
  const [from, to] = span(at);
  return windowsBetween(from, to, loc).find((w) => w.start <= at && at < w.end) ?? null;
}

/** The current window if in one, otherwise the next one. */
export function nextWindow(at, loc) {
  const from = at;
  const to = new Date(at.getTime() + 14 * 864e5);
  const [pastFrom] = span(at);
  return windowsBetween(pastFrom, to, loc).find((w) => w.end > from) ?? null;
}
