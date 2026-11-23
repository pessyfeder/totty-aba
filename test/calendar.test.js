import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb, makeEnv, seedWorld, PASSWORD } from './helpers.js';
import { createApp } from '../src/app.js';

let db, world, server, base, cookie;
before(async () => {
  db = await makeDb();
  const env = makeEnv(db, '2026-11-04T15:00:00Z');
  world = await seedWorld(db);
  const app = createApp({ db, messenger: env.messenger, now: env.now, config: { sessionSecret: 'x'.repeat(40), production: false } });
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'totty' }, body: JSON.stringify({ email: 'totty@example.test', password: PASSWORD }) });
  cookie = r.headers.get('set-cookie').split(';')[0];
});
after(() => server.close());

const call = (method, path, body) => fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'totty', Cookie: cookie }, body: body && JSON.stringify(body) });

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

test('client appointments: need a date; scheduled → completed / missed', async () => {
  const cid = world.client.id;
  assert.equal((await call('POST', `/api/clients/${cid}/appointments`, { type: 'check-in' })).status, 400); // needs a time
  const made = await (await call('POST', `/api/clients/${cid}/appointments`, { type: 'check-in', starts_at: '2027-02-01T15:00:00Z' })).json();
  assert.equal(made.status, 'scheduled');
  const patch = (body) => call('PATCH', `/api/appointments/${made.id}`, body);
  assert.equal((await patch({ status: 'to_be_scheduled' })).status, 400);
  assert.equal((await patch({ status: 'scheduled', starts_at: '2027-02-02T15:00:00Z' })).status, 200);
  assert.equal((await patch({ status: 'bogus' })).status, 400);
  assert.equal((await (await patch({ status: 'missed' })).json()).status, 'missed');
  assert.equal((await (await patch({ status: 'completed' })).json()).status, 'completed');
  const client = await (await call('GET', `/api/clients/${cid}`)).json();
  assert.ok(client.appointments.some((a) => a.id === made.id && a.status === 'completed'));
});
