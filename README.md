# BTB - Behavior Treating Behavior

See [SPEC.md](SPEC.md) for the product spec.

## Try it now (no database install)

```bash
npm install
npm run demo        # http://localhost:3000, login totty@example.test
```

Runs the real app on an in-memory Postgres with sample data. SMS is printed, not sent.

## Run for real

```bash
docker compose up -d                                  # Postgres
cp .env.example .env                                  # fill in SESSION_SECRET
npm run db:migrate
CLINICIAN_PASSWORD='at least 12 chars' node scripts/create-clinician.js \
  totty@example.com "Totty" America/New_York 40.6782 -73.9442
npm start
```

Without Telnyx variables set, outgoing SMS goes to the console. In production (`NODE_ENV=production`) `TELNYX_API_KEY`, `TELNYX_FROM_NUMBER` and `TELNYX_PUBLIC_KEY` are required, and `PUBLIC_URL` is also the base of the report links texted to parents. The Telnyx messaging webhook (`POST /webhooks/telnyx/sms`) must be pointed at `PUBLIC_URL`; requests are verified with the Ed25519 signature Telnyx sends.

## Layout

| Path | Purpose |
|---|---|
| `db/migrations` | PostgreSQL schema |
| `src/shabbos.js` | Shabbos / Yom Tov windows from per-location zmanim |
| `src/messaging.js` | The only send path; refuses sends during a window |
| `src/scheduler.js` | Per-minute tick: create, defer, send, remind, mark no-response |
| `src/inbound.js`, `src/parse.js` | Parent replies |
| `src/app.js`, `src/dashboard.js` | REST API and dashboard queries (locked on Shabbos) |
| `src/reports.js`, `src/report-routes.js` | Progress reports: content, PDF, secure link |
| `public/` | Dashboard UI (no build step) |

`npm test` runs everything against PGlite (real Postgres engine, in process).
