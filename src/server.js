// Entry point: HTTP API + dashboard + the minute-by-minute scheduler.
// Config is all environment variables; see .env.example.
import pg from 'pg';
import { createApp } from './app.js';
import { createMessenger, consoleProvider, twilioProvider } from './messaging.js';
import { createScheduler } from './scheduler.js';

const env = process.env;
const production = env.NODE_ENV === 'production';
for (const k of ['DATABASE_URL', 'SESSION_SECRET']) {
  if (!env[k]) {
    console.error(`${k} is not set`);
    process.exit(1);
  }
}
if (env.SESSION_SECRET.length < 32) {
  console.error('SESSION_SECRET must be at least 32 characters');
  process.exit(1);
}

if (production && (env.DOCUMENT_KEY ?? '').length < 32) {
  console.error('DOCUMENT_KEY (at least 32 characters) is required in production: intake documents are encrypted with it');
  process.exit(1);
}

const db = new pg.Pool({ connectionString: env.DATABASE_URL });
const twilioConfigured = env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER;
if (production && !twilioConfigured) {
  console.error('Twilio credentials are required in production');
  process.exit(1);
}
const provider = twilioConfigured
  ? await twilioProvider({ accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN, from: env.TWILIO_FROM_NUMBER })
  : consoleProvider();

const messenger = createMessenger({ db, provider });
const scheduler = createScheduler({ db, messenger });
const app = createApp({
  db,
  messenger,
  config: {
    production,
    sessionSecret: env.SESSION_SECRET,
    documentKey: env.DOCUMENT_KEY || undefined,
    publicUrl: env.PUBLIC_URL ?? '',
    reportsDir: env.REPORTS_DIR || undefined,
    reportLinkDays: Number(env.REPORT_LINK_DAYS) || 14,
    twilio: twilioConfigured ? { authToken: env.TWILIO_AUTH_TOKEN } : null,
  },
});

let running = false;
setInterval(async () => {
  if (running) return; // never overlap ticks
  running = true;
  try {
    await scheduler.tick();
  } catch (err) {
    console.error('scheduler tick failed:', err);
  } finally {
    running = false;
  }
}, 60_000);

const port = Number(env.PORT ?? 3000);
app.listen(port, () => console.log(`totty-aba listening on :${port}${twilioConfigured ? '' : ' (SMS to console)'}`));
