// Password hashing (scrypt) and stateless signed session cookies.
import { scrypt, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const SESSION_HOURS = 12;
export const COOKIE = 'totty_session';

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, saltHex, keyHex] = (stored ?? '').split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = await scryptAsync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

const sign = (secret, data) => createHmac('sha256', secret).update(data).digest('base64url');

export function createSession(secret, clinicianId, now = new Date()) {
  const payload = Buffer.from(
    JSON.stringify({ cid: clinicianId, exp: now.getTime() + SESSION_HOURS * 3600e3 }),
  ).toString('base64url');
  return `${payload}.${sign(secret, payload)}`;
}

/** @returns {string|null} clinician id, or null if missing/forged/expired */
export function readSession(secret, token, now = new Date()) {
  const [payload, sig] = (token ?? '').split('.');
  if (!payload || !sig) return null;
  const good = Buffer.from(sign(secret, payload));
  const given = Buffer.from(sig);
  if (good.length !== given.length || !timingSafeEqual(good, given)) return null;
  try {
    const { cid, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return exp > now.getTime() ? cid : null;
  } catch {
    return null;
  }
}

export function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map((c) => c.trim().split(/=(.*)/s).slice(0, 2)).filter(([k]) => k),
  );
}
