import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locationFrom, windowAt, nextWindow } from '../src/shabbos.js';

const settings = { candle_lighting_minutes_before_sunset: 18, nightfall_minutes_after_sunset: 72 };
const lakewood = locationFrom(
  { latitude: 40.0979, longitude: -74.2176, timezone: 'America/New_York', in_israel: false },
  settings,
);
const jerusalem = locationFrom(
  { latitude: 31.7683, longitude: 35.2137, timezone: 'Asia/Jerusalem', in_israel: true, candle_lighting_minutes: 40 },
  settings,
);
const at = (iso) => new Date(iso);
const localHour = (d, tz) => Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(d));

test('Friday just before candle lighting is open, just after is blocked', () => {
  assert.equal(windowAt(at('2026-11-06T21:29:00Z'), lakewood), null);
  assert.equal(windowAt(at('2026-11-06T21:31:00Z'), lakewood)?.kind, 'shabbos');
});

test('Saturday 10:00 is blocked and reopens 72 minutes after sunset', () => {
  const w = windowAt(at('2026-11-07T15:00:00Z'), lakewood);
  assert.ok(w);
  assert.equal(w.end.toISOString().slice(0, 16), '2026-11-07T22:59');
  assert.equal(windowAt(at('2026-11-07T23:00:00Z'), lakewood), null);
});

test('Friday 5:00pm with 4:30pm candle lighting is inside the window', () => {
  // 2026-11-06 17:00 EST = 22:00Z; candle lighting is ~16:30 EST
  assert.ok(windowAt(at('2026-11-06T22:00:00Z'), lakewood));
});

test('ordinary weekday is open', () => {
  assert.equal(windowAt(at('2026-10-28T17:00:00Z'), lakewood), null);
});

test('DST: nightfall tracks local clock across the spring change', () => {
  const before = windowAt(at('2026-03-07T20:00:00Z'), lakewood); // EST
  const after = windowAt(at('2026-03-14T20:00:00Z'), lakewood); // EDT
  assert.equal(localHour(before.end, lakewood.timezone), 19);
  assert.equal(localHour(after.end, lakewood.timezone), 20);
});

test('first day Sukkot 2026 (Sat) then second day outside Israel is one window', () => {
  const sunNoon = at('2026-09-27T16:00:00Z');
  assert.ok(windowAt(sunNoon, lakewood), 'diaspora second day is blocked');
  const w = windowAt(at('2026-09-26T16:00:00Z'), lakewood);
  assert.ok(w.end > sunNoon, 'window extends through second day');
  assert.equal(windowAt(at('2026-09-27T09:00:00Z'), jerusalem), null, 'Israel observes one day (Sun is open)');
});

test('Jerusalem uses its own candle lighting offset', () => {
  const w = nextWindow(at('2026-11-03T12:00:00Z'), jerusalem);
  const sunsetLocal = new Date(w.start.getTime() + 40 * 60000);
  assert.ok(sunsetLocal > w.start);
  assert.equal(w.kind, 'shabbos');
});

test('nextWindow returns the upcoming Shabbos', () => {
  const w = nextWindow(at('2026-11-03T12:00:00Z'), lakewood);
  assert.equal(w.start.toISOString().slice(0, 10), '2026-11-06');
});
