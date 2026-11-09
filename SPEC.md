# Totty's ABA: Product Spec (v0.1 draft)

## 1. Overview
A web app for Totty, a BCBA, to track client progress on behavioral goals. Parents report on each goal by SMS or phone call at scheduled times. Their answers feed per-goal charts, and Totty can create a progress report for any client on demand. Nothing is sent during Shabbos (see 5.3).

## 2. Users
| Role | Description | Access |
|---|---|---|
| Totty (BCBA, admin) | Manages clients, goals, schedules, and reports | Full web app, password login |
| Parent / caregiver | Answers prompts and receives weekly reports | SMS/voice only, no login in v1 |

Single-clinician in v1. Design the data model with a `clinician_id` so multi-user can be added later.

## 3. Goals and non-goals
**Goals**
- Capture parent-reported goal data with minimal effort (reply Y/N or a number).
- Show progress per goal over time.
- Let Totty create a progress report for any client and date range on demand, and send it to the parent.
- Never contact families on Shabbos.

**Non-goals (v1)**
- Parent login portal, in-app messaging, billing/insurance, direct-observation data collection by technicians, multi-clinic support.

## 4. Core concepts
- **Client**: the child being served.
- **Contact**: a parent/caregiver for a client; has a phone number and a preferred channel (SMS or call).
- **Goal**: a target behavior for a client, with a response type and a schedule.
- **Prompt**: one scheduled ask for a goal on a given date/time.
- **Response**: a parent's answer to a prompt.

## 5. Functional requirements

### 5.1 Client management
- Create, edit, and archive clients.
- **Editing**: the client page has an **Edit** button that opens the same form used to create a client, pre-filled. Every client field is editable, including name, gender, DOB, admission date, location, timezone, Israel/Yom Tov setting, candle-lighting offset, and notes. Optional fields can be cleared. Required fields (name, admission date, location, timezone) cannot be left blank. Each edit is recorded in the audit log (which fields changed).
- A location or timezone change takes effect for the Shabbos window immediately: every send is checked against the client's current location when it is due, including prompts already scheduled. Send times of prompts already created keep their original instant; newly created prompts use the new timezone.
- **Archiving**: **Archive client** (on the edit page, after confirmation) stops all prompts for the client and removes them from the dashboard and client list. History and charts are kept. The dashboard links to an **Archived clients** list; opening a client there leads to its edit page, where **Restore client** is offered. An archived client can be restored, which resumes prompts from the next scheduled slot (missed slots are not backfilled).
- Each client has an **admission date** (date admitted to Totty's services), required when creating the client.
- Client page shows: first and last name, gender, age, DOB, admission date, parent/guardian names, phone(s), email, preferred channel, language, notes, and the list of goals with a chart each.
- Client list with search and an "attention needed" flag (e.g., missed responses or declining trend).

### 5.2 Goals
Each goal has:
- Title and description (e.g., "Uses a spoon independently at dinner").
- **Response type** (one per goal):
  - `yes_no`: parent replies Y or N.
  - `rating`: parent replies 0-5, with an optional free-text comment.
- **Schedule**: days of week and a time of day (client's local timezone). Can be daily, specific days, or weekly.
- **Contact** to prompt, and **channel** (SMS or voice call). Default to the contact's preference.
- **Date added**: the date the goal was added to the client's plan. Set automatically to today on creation, editable by Totty, and shown on the goal and its chart.
- Start date (first prompt date, may differ from date added), optional end date, status (active, paused, achieved, discontinued).
- Optional target criterion (e.g., "80% Y over 2 weeks", or "average at least 4") used for the chart target line and an "achieved" suggestion.

### 5.3 Shabbos / no-send rule
- No SMS or call is ever sent from Friday at candle lighting until Saturday nightfall (tzeis hakochavim).
- **Per-client location**: the window is computed separately for each recipient from that client's own location (city or lat/long, plus timezone), not from a single global setting. Each client record stores a location. For Totty's own app lock, the window is computed from Totty's location.
- Use a zmanim library or API. Candle lighting is 18 minutes before sunset by default (adjustable per location, since some communities use a different custom, e.g. 40 minutes in Jerusalem).
- **Nightfall follows the most stringent opinion (Rabbeinu Tam)**: 72 minutes after sunset. This is the default, set in Settings, and applies to all clients.
- Any prompt scheduled in that window is queued and sent at nightfall, in order, with a small stagger to avoid flooding. Prompts that have been pushed past the following scheduled occurrence are skipped or merged (configurable; default: send latest only).
- **Yom Tov**: the same rule applies on Jewish holidays (including the second day outside Israel, and Shabbos/Yom Tov that run back to back). The window runs from candle lighting before the holiday until nightfall at its end, and is computed from the same zmanim data and each client's location (diaspora vs. Israel observance).
- **The rule is enforced at the send layer**, not only in scheduling. The send function refuses to dispatch during a blocked window, even if called manually. Inbound replies from parents are still recorded at any time.
- Dated by the system clock in the recipient's timezone.

**Totty does not use the app on Shabbos**
- Totty is Shabbos-observant and will not click Send (or operate the app) on Shabbos. The app therefore never depends on any action from him during the blocked window.
- During the window, the web UI is locked for Totty: the login page and any open session show a Shabbos notice with the time the app reopens, and all actions (including Send, Create report, and edits) are disabled. The server rejects them too, not just the buttons.
- Everything that happens on Shabbos is passive: parents' inbound replies are recorded (see above), and nothing is sent. Queued prompts are sent automatically after nightfall, with no action from Totty.
- A manual Send (such as a report) is dispatched immediately or not at all. It is never queued to go out later, so nothing Totty does before Shabbos is sent during it. If Totty clicks Send after the window has started, the app refuses it and tells him when it reopens.

### 5.4 Prompting and response capture
**SMS**
- Message states client name and goal. For example: "Hi, Mrs. Cohen. Did Dovid use a spoon at dinner today? Reply Y or N."
- Accepts Y/YES/N/NO case-insensitively. For ratings: "Reply 0-5 (5 = best). You can add a comment after the number, e.g., `4 did great with reminders`."
- For ratings, the reply `4` is accepted immediately. A follow-up "Any comment? Reply or ignore" is optional and configurable.
- Unparseable replies get one re-prompt; after that, store the raw text as unparsed and flag for review.
- If several prompts are open for a contact, each message includes a short code (e.g., "Goal 2") and replies are matched to the most recent open prompt unless a code is given. A single combined message listing multiple goals is a later option.
- No opt-out feature in the app. A parent who wants prompts to stop speaks to Totty directly, and Totty pauses or ends the goal (or the contact) himself.

**Voice call**
- Automated call (text-to-speech): read the question, accept keypad input (1 = yes, 2 = no; or digits 0-5 for rating), and repeat on no input.
- If no answer, retry per retry policy (see below), then fall back to SMS if configured.
- Optional: record a voice comment and transcribe it.

**Reminders and retries**
- If no response within N hours (default 3), send one reminder. Then mark as `no_response` at end of day.
- Late replies (up to 24h) are still accepted and attached to the original prompt's date.

### 5.5 Charts and progress
- Per goal, a chart over a selectable range (1 week, 1 month, 3 months, all):
  - `yes_no`: percent met per week plus a daily dot strip (Y/N/no response).
  - `rating`: line of daily 0-5 ratings with a moving average.
- Target line and phase-change markers (Totty can annotate a date, e.g., "new intervention started").
- Comments display on hover/click on the data point.
- Missing responses shown distinctly, never counted as N.
- Client overview page shows all goal charts, with a summary of trend (improving, flat, declining).
- Totty can manually add or edit a data point (with an audit note), e.g., when a parent tells him by phone.

### 5.6 Progress reports
- Reports are created on demand: Totty clicks **Create report** on a client's page and picks a period: **weekly** (Sunday-Saturday), **monthly** (calendar month), or **custom** (any start and end date). The default is the most recent completed week. Nothing is generated or sent automatically.
- Contents: client name, date range, per-goal summary (responses received, % met or average rating, change vs. prior period, small chart), parent comments, Totty's optional note, and next-period focus.
- Totty previews and edits the report, then chooses **Send** or **Download PDF**. Sending is always a manual action.
- Delivery: the PDF is stored in the app and sent to the parent as an **SMS containing a secure link** (no email delivery). The link is unguessable and expires after a set period (default 14 days), and the text itself contains no progress details, only the child's first name. Reports can only be created or sent outside the Shabbos window; the app is locked for Totty during it (see 5.3).
- Report history is viewable per client.

### 5.6a Preferred reinforcements
- Each client has a simple list of **preferred reinforcements** (also called reinforcers), e.g., "bubbles", "iPad time", "gummy bears". It is a record only: no data collection, no scoring, and no chart.
- Each entry is a name and an optional note. Totty adds, edits, and removes entries.
- The list is shown on the client page and on that client's dashboard card.

### 5.7 Dashboard
- A card per client listing their preferred reinforcements (see 5.6a), with a link to the client page.
- Today's prompts and their status (scheduled, sent, answered, no response).
- Unparsed replies queue.
- Upcoming Shabbos window with next send-resume time.
- Clients needing attention.

### 5.8 Settings
- Location and timezone, Shabbos/Yom Tov rules, quiet hours (e.g., no messages before 8am or after 9pm), sender number, report options, retry policy.

## 6. Data model (draft)
- `clinician(id, name, email, password_hash, timezone, location, settings_json)`
- `client(id, clinician_id, first_name, last_name, gender, age, dob, admission_date, notes, location, timezone, status)`
- `reinforcement(id, client_id, name, note)`
- `contact(id, client_id, name, relationship, phone, email, preferred_channel, language)`
- `goal(id, client_id, contact_id, title, description, response_type, channel, schedule_json, date_added, start_date, end_date, status, target_json)`
- `prompt(id, goal_id, scheduled_for, sent_at, channel, status, attempts, deferred_reason)`
- `response(id, prompt_id, received_at, value_bool, value_int, comment, raw_text, source, parse_status)`
- `annotation(id, goal_id, date, text)`
- `report(id, client_id, period_type, period_start, period_end, status, pdf_path, sent_at, note)`
- `message_log(id, direction, to_from, body, provider_id, status, created_at)`

## 7. Architecture (recommended)
- **Frontend**: React with a charting library such as Chart.js.
- **Backend**: Node.js (Express) or Python (FastAPI), REST/JSON API.
- **Database**: PostgreSQL. This is a production setup: managed hosting, automated backups, environment separation (staging and production), and monitoring.
- **Scheduler**: a persistent job queue (e.g., a database-backed queue or cron-style worker) that runs every minute, picks due prompts, checks the Shabbos guard, and sends.
- **Messaging**: Twilio (SMS + Voice) with inbound webhooks and delivery-status webhooks.
- **Zmanim**: a library such as KosherZmanim, using lat/long and timezone.
- **PDF**: server-side HTML-to-PDF.
- **Auth**: session or JWT login for Totty; webhooks verified with provider signatures.
- **Hosting**: any small HTTPS host; secrets in environment variables.

## 8. Non-functional requirements
- **Privacy / compliance**: this is health-related information about children. Treat as PHI. Encrypt in transit and at rest, minimize PHI in SMS (first name or initials only, no diagnosis), keep audit logs, and obtain written parent consent to text/call. HIPAA applicability and a BAA with vendors (Twilio offers one) need confirmation.
- **Reliability**: no prompt is sent twice; sends are idempotent. The queue survives restarts.
- **Correctness of Shabbos rule**: unit tests with fixed dates across DST changes, long and short Fridays, and different locations.
- **Accessibility**: keyboard-navigable, readable chart colors, mobile-friendly (Totty will likely use a phone).
- **Backups**: daily database backup.

## 9. Acceptance criteria (selected)
1. A prompt scheduled for Saturday 10:00 is not sent then, and is sent within 5 minutes after computed nightfall.
2. A prompt scheduled for Friday 5:00 pm in a location where candle lighting is 4:30 pm is deferred until Saturday nightfall.
3. Replying "y" to a yes/no prompt creates a response of true and the chart updates within 10 seconds.
4. Replying "3 tough day, needed help" to a rating prompt stores value 3 and the comment.
5. A day with no reply shows as "no response", not as a failed goal, in the chart and in the weekly percent.
6. Clicking Create report on a client produces a preview containing every active goal for the chosen range, and no report is created or sent without that click.
7. Pausing a goal or contact stops all further prompts for it.
8. Calling the send function directly during Shabbos fails with a logged refusal.
9. During the Shabbos window, logging in or performing any action as Totty is refused with a notice showing when the app reopens, and a parent's reply received then is still recorded.

## 10. Milestones
1. **MVP**: login, clients, contacts, goals, SMS yes/no + rating prompts, scheduler with Shabbos guard, per-goal charts.
2. On-demand PDF reports (create, preview, edit, send).
3. Voice-call prompts, reminders and retries, dashboard.
4. Annotations, manual data entry, Yom Tov calendar, multi-clinician support.

## 11. Open questions
1. **Prompt volume**: how many clients and goals per client? This affects Twilio costs and the combined-message design.
2. **Response type**: Y/N or 0-5? Is the type chosen by Totty per goal, or should a goal ever allow both?
3. **Consent and HIPAA**: does Totty already have a parent consent process, and does he want the app built to HIPAA standard from day one?
4. **Voice calls**: automated robot voice only, or could Totty ever want to be called in too?
5. **Languages**: English only, or also Hebrew/Yiddish prompts?