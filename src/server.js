// Entry point: HTTP API + dashboard + the minute-by-minute scheduler.
// Config is all environment variables; see .env.example.
import pg from 'pg';
import { createApp } from './app.js';
import { createMessenger, consoleProvider, telnyxProvider } from './messaging.js';
import { createScheduler } from './scheduler.js';
import { consoleMailer, sendApproved, smtpMailer, unconfiguredMailer } from './consult-email.js';
import { sendApproved as sendApprovedInquiry } from './inquiry-email.js';
import { syncAll, httpFetchText } from './calendar.js';

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
const telnyxConfigured = env.TELNYX_API_KEY && env.TELNYX_FROM_NUMBER && env.TELNYX_PUBLIC_KEY;
if (production && !telnyxConfigured) {
  console.error('Telnyx credentials (TELNYX_API_KEY, TELNYX_FROM_NUMBER, TELNYX_PUBLIC_KEY) are required in production');
  process.exit(1);
}
const provider = telnyxConfigured
  ? telnyxProvider({ apiKey: env.TELNYX_API_KEY, from: env.TELNYX_FROM_NUMBER, messagingProfileId: env.TELNYX_MESSAGING_PROFILE_ID || undefined })
  : consoleProvider();

const messenger = createMessenger({ db, provider });
const scheduler = createScheduler({ db, messenger });
// Email (initial consultation email, SPEC 5.7b). Dev prints to the console; production without SMTP refuses to send.
const smtpConfigured = env.SMTP_URL && env.EMAIL_FROM;
const mailer = smtpConfigured
  ? await smtpMailer({ url: env.SMTP_URL, from: env.EMAIL_FROM })
  : production ? unconfiguredMailer : consoleMailer();
if (production && !smtpConfigured) console.warn('SMTP_URL and EMAIL_FROM are not set: the consultation email cannot be sent');
const app = createApp({
  db,
  messenger,
  mailer,
  fetchCalendar: httpFetchText,
  config: {
    production,
    sessionSecret: env.SESSION_SECRET,
    documentKey: env.DOCUMENT_KEY || undefined,
    publicUrl: env.PUBLIC_URL ?? '',
    reportsDir: env.REPORTS_DIR || undefined,
    reportLinkDays: Number(env.REPORT_LINK_DAYS) || 14,
    telnyx: telnyxConfigured ? { publicKey: env.TELNYX_PUBLIC_KEY } : null,
  },
});

let running = false;
setInterval(async () => {
  if (running) return; // never overlap ticks
  running = true;
  try {
    await scheduler.tick();
    await sendApproved({ db, mailer }); // approved consultation emails that waited out a Shabbos window
    await sendApprovedInquiry({ db, mailer }); // same for first-reply emails
  } catch (err) {
    console.error('scheduler tick failed:', err);
  } finally {
    running = false;
  }
}, 60_000);

const port = Number(env.PORT ?? 3000);
app.listen(port, () => console.log(`totty-aba listening on :${port}${telnyxConfigured ? '' : ' (SMS to console)'}`));

// Read-only Google Calendar sync (SPEC 5.7b): every 10 minutes for clinicians who connected a calendar.
let syncing = false;
const syncCalendars = async () => {
  if (syncing) return;
  syncing = true;
  try { await syncAll({ db, fetchText: httpFetchText }); } finally { syncing = false; }
};
setInterval(syncCalendars, 10 * 60_000);
syncCalendars();
