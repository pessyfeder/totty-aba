// Applies db/migrations/*.sql in order, once each, tracked in schema_migrations.
// Usage: DATABASE_URL=postgres://... node scripts/migrate.js [--seed]
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const dir = path.join(root, 'db', 'migrations');
  for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    await client.query('BEGIN');
    try {
      await client.query(await readFile(path.join(dir, file), 'utf8'));
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log('applied', file);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  }
  if (process.argv.includes('--seed')) {
    await client.query(await readFile(path.join(root, 'db', 'seed.sql'), 'utf8'));
    console.log('seeded');
  }
} finally {
  await client.end();
}
