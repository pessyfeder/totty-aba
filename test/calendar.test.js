import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb, makeEnv, seedWorld, PASSWORD } from './helpers.js';
import { createApp } from '../src/app.js';
import { parseIcs, normalizeFeedUrl, appointmentType } from '../src/calendar.js';

const FEED = 'https://calendar.google.com/calendar/ical/x%40gmail.com/private-abc/basic.ics';
const ics = (...events) => ['BEGIN:VCALENDAR', ...events, 'END:VCALENDAR'].join('\r\n');
const vevent = (uid, { summary = 'Check-in', start = '20261110T150000Z', extra = [] } = {}) =>
  ['BEGIN:VEVENT', `UID:${uid}`, `SUMMARY:${summary}`, `DTSTART:${start}`, 'DTEND:20261110T160000Z', ...extra, 'END:VEVENT'].join('\r\n');

test('parseIcs: UTC, TZID, folded lines, attendees, cancelled, recurring skipped', () => {
  const evs = parseIcs(ics(
    vevent('a', { summary: 'Consultation with Rivka', extra: ['ATTENDEE;CN=Rivka:mailto:Rivka@Example.test'] }),
    vevent('b', { start: '20261110T100000' }).replace('DTSTART:', 'DTSTART;TZID=America/New_York:'),
    vevent('c', { extra: ['STATUS:CANCELLED'] }),
    vevent('d', { extra: ['RRULE:FREQ=WEEKLY'] }),
    vevent('e', { summary: 'Long\r\n  title' }),
  ));
  assert.deepEqual(evs.map((e) => e.uid), ['a', 'b', 'c', 'e']);
  assert.deepEqual(evs[0].attendees, ['rivka@example.test']);
  assert.equal(evs[1].start.toISOString(), '2026-11-10T15:00:00.000Z');
  assert.equal(evs[2].cancelled, true);
  assert.equal(evs[3].title, 'Long title');
});

test('feed address must be https on calendar.google.com; webcal is converted', () => {
  assert.equal(normalizeFeedUrl(FEED), FEED);
  assert.ok(normalizeFeedUrl(FEED.replace('https:', 'webcal:')).startsWith('https://'));
  assert.equal(normalizeFeedUrl('https://evil.test/x.ics'), null);
  assert.equal(normalizeFeedUrl('http://calendar.google.com/x'), null);
  assert.equal(appointmentType('Initial Consultation'), 'consultation');
  assert.equal(appointmentType('Check in'), 'check-in');
  assert.equal(appointmentType('Meeting'), 'ongoing meeting');
});

let db, world, server, base, cookie, feed;
before(async () => {
  db = await makeDb();
  const env = makeEnv(db, '2026-11-04T15:00:00Z');
  world = await seedWorld(db);
  await db.query(`UPDATE contact SET email = 'mom@example.test' WHERE client_id = $1`, [world.client.id]);
  const app = createApp({ db, messenger: env.messenger, now: env.now, fetchCalendar: async () => feed, config: { sessionSecret: 'x'.repeat(40), production: false } });
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'totty' }, body: JSON.stringify({ email: 'totty@example.test', password: PASSWORD }) });
  cookie = r.headers.get('set-cookie').split(';')[0];
});
after(() => server.close());

const call = (method, path, body) => fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'totty', Cookie: cookie }, body: body && JSON.stringify(body) });

test('sync needs a connected calendar; the secret address is never returned', async () => {
  assert.equal((await call('POST', '/api/calendar/sync')).status, 400);
  assert.equal((await call('PUT', '/api/settings', { calendar_ics_url: 'https://evil.test/x.ics' })).status, 400);
  const put = await (await call('PUT', '/api/settings', { calendar_ics_url: FEED })).json();
  assert.equal(put.calendar_connected, true);
  assert.equal(JSON.stringify(await (await call('GET', '/api/settings')).json()).includes('private-abc'), false);
});

test('sync matches by contact email, updates changes, cancels removed events, is idempotent', async () => {
  feed = ics(
    vevent('m1', { summary: 'Check-in', extra: ['ATTENDEE:mailto:mom@example.test', 'ATTENDEE:mailto:totty@example.test'] }),
    vevent('u1', { summary: 'Consultation', start: '20261112T150000Z', extra: ['ATTENDEE:mailto:stranger@example.test'] }),
  );
  let r = await (await call('POST', '/api/calendar/sync')).json();
  assert.deepEqual([r.created, r.updated, r.cancelled], [2, 0, 0]);
  r = await (await call('POST', '/api/calendar/sync')).json();
  assert.deepEqual([r.created, r.updated, r.cancelled], [0, 0, 0]);

  const list = await (await call('GET', '/api/appointments')).json();
  assert.equal(list.length, 2);
  assert.equal(list[0].client_id, world.client.id);
  assert.equal(list[0].type, 'check-in');
  assert.equal(list[1].client_id, null);

  // the stranger's email is added to a contact: the next sync links the existing appointment
  await db.query(`UPDATE contact SET email = 'stranger@example.test' WHERE client_id = $1`, [world.client.id]);
  feed = ics(
    vevent('m1', { summary: 'Check-in', start: '20261111T150000Z', extra: ['ATTENDEE:mailto:mom@example.test'] }),
    vevent('u1', { summary: 'Consultation', start: '20261112T150000Z', extra: ['ATTENDEE:mailto:stranger@example.test'] }),
  );
  r = await (await call('POST', '/api/calendar/sync')).json();
  assert.deepEqual([r.created, r.updated], [0, 2]);

  // m1 deleted in the calendar
  feed = ics(vevent('u1', { summary: 'Consultation', start: '20261112T150000Z', extra: ['ATTENDEE:mailto:stranger@example.test'] }));
  r = await (await call('POST', '/api/calendar/sync')).json();
  assert.equal(r.cancelled, 1);
  assert.equal((await (await call('GET', '/api/appointments')).json()).length, 1);

  const client = await (await call('GET', `/api/clients/${world.client.id}`)).json();
  assert.equal(client.appointments.length, 2);
  const dash = await (await call('GET', '/api/dashboard')).json();
  assert.equal(dash.appointments.length, 1);
});

test('appointment page: kind (consultation / first / later check-in) and notes', async () => {
  const mk = (ext, type, at) => db.query(
    `INSERT INTO appointment (clinician_id, client_id, external_id, type, starts_at) SELECT clinician_id, id, $1, $2, $3 FROM client WHERE id = $4 RETURNING id`,
    [ext, type, at, world.client.id]).then((r) => r.rows[0].id);
  const c = await mk('k-consult', 'consultation', '2027-01-05T15:00:00Z');
  const first = await mk('k-first', 'check-in', '2027-01-12T15:00:00Z');
  const later = await mk('k-later', 'check-in', '2027-01-26T15:00:00Z');
  const kind = async (id) => (await (await call('GET', `/api/appointments/${id}`)).json()).kind;
  assert.equal(await kind(c), 'initial_consultation');
  assert.equal(await kind(first), 'first_checkin');
  assert.equal(await kind(later), 'biweekly_checkin');
  assert.equal((await call('PATCH', `/api/appointments/${first}`, { notes: ' Reviewed baseline ' })).status, 200);
  assert.equal((await (await call('GET', `/api/appointments/${first}`)).json()).notes, 'Reviewed baseline');
  assert.equal((await call('PATCH', `/api/appointments/${first}`, { notes: 5 })).status, 400);
  assert.equal((await call('GET', '/api/appointments/00000000-0000-0000-0000-000000000000')).status, 404);
});
