// Creates (or updates the password of) a clinician login.
// Usage: DATABASE_URL=... CLINICIAN_PASSWORD=... node scripts/create-clinician.js <email> <name> <timezone> <lat> <lng> [israel]
import pg from 'pg';
import { hashPassword } from '../src/auth.js';

const [email, name, timezone, lat, lng, israel] = process.argv.slice(2);
const password = process.env.CLINICIAN_PASSWORD;
if (!process.env.DATABASE_URL || !email || !name || !timezone || !lat || !lng || !password) {
  console.error('Usage: DATABASE_URL=... CLINICIAN_PASSWORD=... node scripts/create-clinician.js <email> <name> <timezone> <lat> <lng> [israel]');
  process.exit(1);
}
if (password.length < 12) {
  console.error('CLINICIAN_PASSWORD must be at least 12 characters');
  process.exit(1);
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  await db.query(
    `INSERT INTO clinician (name, email, password_hash, timezone, latitude, longitude, in_israel)
     VALUES ($1, lower($2), $3, $4, $5, $6, $7)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    [name, email, await hashPassword(password), timezone, lat, lng, israel === 'israel'],
  );
  console.log(`clinician ${email} ready`);
} finally {
  await db.end();
}
