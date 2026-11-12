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
- Capture parent-reported goal data with minimal effort (reply Y/N, or a number of minutes for duration goals).
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
- **Contacts pane**: parent/guardian contact details are added and edited on a separate **Contacts** page (client page > Edit contacts), not inline with goals. Editable: name, relationship, mobile (international format), email, preferred channel, language, status (active, paused, ended), consent to texts/calls, and a consent note. The consent date is recorded when consent is first ticked and kept while it stays ticked. Pausing or ending a contact stops all prompts to that person. Contacts are not deleted.
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
  - `duration`: parent replies with a number of minutes (e.g., `15`), meaning how long the behavior lasted or the activity took. The reply is a plain number only.
- **Schedule**: days of week and a time of day (client's local timezone). Can be daily, specific days, or weekly.
- **Contact** to prompt, and **channel** (SMS or voice call). Default to the contact's preference.
- **Date added**: the date the goal was added to the client's plan. Defaults to today on creation (Totty may set it when adding the goal) and is shown on the goal and its chart.
- Start date (first prompt date, may differ from date added), optional end date, status (active, paused, archived).
- **Goals are add-and-archive only.** Once added, a goal's title, question, schedule, contact, type, dates and target cannot be edited, so its chart and history always mean what they said when the data was collected. To change a goal, Totty archives it and adds a new one. The only changes allowed on an existing goal are **Pause/Resume** (prompts stop while paused) and **Archive**. Archiving asks for confirmation, stops all prompts, cannot be undone, and keeps the goal's history and chart, which appear under "Archived goals" on the client page. Chart notes (5.5) can still be added to active goals.
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
- Accepts Y/YES/N/NO case-insensitively.
- **Parent replies are one of two kinds**: a yes/no answer, or a number of minutes (duration). For a duration goal the message asks, e.g., "How many minutes did Dovid spend on X today? Reply with a number, e.g., `15`." The reply is the number of minutes the parent texts. Accepts whole numbers (and optionally a trailing "min"/"minutes"); `0` is a valid answer. A reply that is not a number is treated as unparseable (below). Values above a sanity limit (default 1440, one day) are treated as unparseable.
- **Replies carry no notes or comments**: a parent's reply is only Y/N or a number of minutes, and the app never asks for a comment. Any extra text is ignored (the reply is still recorded from the Y/N or number it starts with). A reply is accepted immediately.
- Unparseable replies get one re-prompt; after that, store the raw text as unparsed and flag for review.
- If several prompts are open for a contact, each message includes a short code (e.g., "Goal 2") and replies are matched to the most recent open prompt unless a code is given. A single combined message listing multiple goals is a later option.
- No opt-out feature in the app. A parent who wants prompts to stop speaks to Totty directly, and Totty pauses or ends the goal (or the contact) himself.

**Voice call**
- Automated call (text-to-speech): read the question, accept keypad input (1 = yes, 2 = no; or digits followed by # for minutes on a duration goal), and repeat on no input.
- If no answer, retry per retry policy (see below), then fall back to SMS if configured.

**Reminders and retries**
- **Follow-ups**: if there is no reply 30 minutes after the prompt (`followup_after_minutes`), send a follow-up text ("Reminder: ..." with the same question), and again 30 minutes after each follow-up, up to **3 follow-ups** (`max_followups`). A reply at any point stops them. Follow-ups are never sent in quiet hours or a Shabbos/Yom Tov window, and a follow-up that could not be sent is dropped, not queued. After the last follow-up the prompt stays open until the end of the client's local day, then becomes `no_response`.
- Follow-up by **voice call** (for contacts whose preferred channel is a call) arrives with voice prompts in milestone 3: the same timing and limit will apply, with the call replacing the text.
- Late replies (up to 24h) are still accepted and attached to the original prompt's date.

### 5.5 Charts and progress
- Per goal, a chart over a selectable range (1 week, 1 month, 3 months, all):
  - `yes_no`: percent met per week plus a daily dot strip (Y/N/no response).
  - `duration`: line or bars of daily minutes with a moving average, and the weekly average and total.
- Target line and phase-change markers (Totty can annotate a date, e.g., "new intervention started").
- Missing responses shown distinctly, never counted as N.
- Client overview page shows all goal charts, with a summary of trend (improving, flat, declining).
- Totty can manually add or edit a data point (with an audit note), e.g., when a parent tells him by phone.

### 5.6 Progress reports
- Reports are created on demand: Totty clicks **Create report** on a client's page and picks a period: **weekly** (Sunday-Saturday), **monthly** (calendar month), or **custom** (any start and end date). The default is the most recent completed week. Nothing is generated or sent automatically.
- Contents: client name, date range, per-goal summary (responses received, % met or average minutes, change vs. prior period, small chart), parent comments, Totty's optional note, and next-period focus.
- Totty previews and edits the report, then chooses **Send** or **Download PDF**. Sending is always a manual action.
- Delivery: the PDF is stored in the app and sent to the parent as an **SMS containing a secure link** (no email delivery). The link is unguessable and expires after a set period (default 14 days), and the text itself contains no progress details, only the child's first name. Reports can only be created or sent outside the Shabbos window; the app is locked for Totty during it (see 5.3).
- Report history is viewable per client (period, type, status, date sent).
- **How it works in v1:**
  - Period choices snap to whole periods: weekly is always Sunday to Saturday, monthly is a whole calendar month, custom allows up to one year. Create report builds a **draft** and opens the preview.
  - The report includes **every active goal**, even with no replies, plus any paused or archived goal that was asked something in the period. "Change vs. prior period" compares with the immediately preceding period of the same length.
  - Only answered prompts count: a day with no reply is shown as a missing mark and is never counted as No (5.5).
  - In the preview Totty can edit his note, the next-period focus, a remark under each goal, and untick any parent comment he does not want included. Everything else is generated from the data and cannot be edited.
  - **Download PDF** produces the current draft without changing anything. **Send to parent** asks Totty to pick a contact (active, with a mobile number and recorded consent), confirms, then freezes the report, stores the PDF, and texts the link right away. A report that has been sent cannot be edited or sent again; to send updated figures Totty creates a new report.
  - The text reads: "A progress report for <first name> is ready: <link>". If the text cannot go out (including a Shabbos refusal), nothing is stored as sent and the report stays a draft.
  - The link opens the PDF with no login, until it expires (default 14 days, `REPORT_LINK_DAYS`). Only a hash of the token is stored. After expiry it shows a short "ask Totty for a new one" message. Opening the link is read-only, so it works during Shabbos; only Totty's actions are locked.
  - PDFs use standard Latin fonts: characters outside them (for example Hebrew in a parent comment) print as "?" in the PDF in v1.

### 5.6a Preferred reinforcements
- Each client has a simple list of **preferred reinforcements** (also called reinforcers), e.g., "bubbles", "iPad time", "gummy bears". It is a record only: no data collection, no scoring, and no chart.
- Each entry is a name and an optional note. Totty adds, edits, and removes entries.
- The list is shown on the client page and on that client's dashboard card.

### 5.7 Dashboard
- A card per client listing their preferred reinforcements (see 5.6a), with a link to the client page.
- Today's prompts and their status (scheduled, sent, answered, no response).
- Unparsed replies queue.
- A notice with the reopen time while a Shabbos / Yom Tov window is in effect. No notice about upcoming windows.
- Clients needing attention.

### 5.7a Parent check-in prompt
- Seven days (one week) after a parent first receives messages from the app, they get a one-time text prompting them to set up a **check-in appointment with Yisroel Feder, BCBA, LBA**.
- The seven days are counted from the first prompt actually sent to that contact (`first_message_at`), not from when the contact was created. The check-in text goes out at the next permitted time after day 7 and follows every send rule: never during Shabbos/Yom Tov, never in quiet hours, only to active contacts with recorded consent. If it cannot go out in a blocked window it is sent after the window ends (it is not dropped).
- It is sent once per contact (`checkin_prompt_sent_at`), and is not repeated if the contact is paused and resumed. It is logged in the message log like any other message.
- The text contains no progress details, only the child's first name and the invitation to schedule.
- **The text includes a link to book the appointment** (a scheduling link, stored in Settings as `CHECKIN_BOOKING_URL`) **and a payment reminder**: payment is due up to 48 hours before the appointment. Example: "Time to schedule a check-in for <first name> with Yisroel Feder, BCBA, LBA: <link>. Please remember payment is due 48 hours before your appointment."

### 5.8 Settings
- Location and timezone, Shabbos/Yom Tov rules, quiet hours (e.g., no messages before 8am or after 9pm), sender number, report options, follow-up timing and limit (defaults 30 minutes, 3 follow-ups).

## 6. Data model (draft)
- `clinician(id, name, email, password_hash, timezone, location, settings_json)`
- `client(id, clinician_id, first_name, last_name, gender, age, dob, admission_date, notes, location, timezone, status)`
- `reinforcement(id, client_id, name, note)`
- `contact(id, client_id, name, relationship, phone, email, preferred_channel, language, first_message_at, checkin_prompt_sent_at)`
- `goal(id, client_id, contact_id, title, description, response_type, channel, schedule_json, date_added, start_date, end_date, status, target_json)`
- `prompt(id, goal_id, scheduled_for, sent_at, channel, status, attempts, deferred_reason, followups_sent, last_followup_at)`
- `response(id, prompt_id, received_at, value_bool, value_minutes, comment, raw_text, source, parse_status)`
- `annotation(id, goal_id, date, text)`
- `report(id, client_id, period_type, period_start, period_end, status, content_json, pdf_path, sent_at, note, link_token_hash, link_expires_at)`
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
4. Replying "20 tough day" to a duration prompt stores 20 minutes and ignores the extra text.
5. A day with no reply shows as "no response", not as a failed goal, in the chart and in the weekly percent.
6. Clicking Create report on a client produces a preview containing every active goal for the chosen range, and no report is created or sent without that click.
7. Pausing a goal or contact stops all further prompts for it.
8. Calling the send function directly during Shabbos fails with a logged refusal.
9. During the Shabbos window, logging in or performing any action as Totty is refused with a notice showing when the app reopens, and a parent's reply received then is still recorded.
10. Replying "20" to a duration prompt stores 20 minutes and the chart updates; replying "abc" is treated as unparseable.
11. A contact whose first prompt was sent 7 days ago receives the check-in text with Yisroel Feder, BCBA, LBA once, at a permitted time (not during Shabbos or quiet hours), and never again.

## 10. Milestones
1. **MVP**: login, clients, contacts, goals, SMS yes/no + duration prompts, scheduler with Shabbos guard, per-goal charts.
2. On-demand PDF reports (create, preview, edit, send).
3. Voice-call prompts, reminders and retries, dashboard.
4. Annotations, manual data entry, Yom Tov calendar, multi-clinician support.
5. **Cross-device app (later stage)**: Totty's app runs on both phone and computer. One responsive web app (installable to the phone home screen as a PWA) with a layout that adapts from phone to desktop, covering every Totty-facing screen: dashboard, clients, goals, charts, and report create/preview/edit. No separate native apps unless a later need (e.g. push notifications on iOS) requires it. The Shabbos lock applies the same on every device.

## 11. Open questions
1. **Prompt volume**: how many clients and goals per client? This affects Twilio costs and the combined-message design.
2. **Response type**: Y/N or minutes? Is the type chosen by Totty per goal, or should a goal ever allow both?
3. **Consent and HIPAA**: does Totty already have a parent consent process, and does he want the app built to HIPAA standard from day one?
4. **Voice calls**: automated robot voice only, or could Totty ever want to be called in too?
5. **Languages**: English only, or also Hebrew/Yiddish prompts?
6. **Parents on tablets and computers**: texts reach phones only. Do any parents need prompts on a tablet or computer? Options: (a) prompts also sent by email with a private link to a one-tap answer page that works on any device, no login (recommended; texts stay the default so basic and kosher phones keep working); (b) an installable parent web app with push notifications (needs a parent login, does not work on basic phones); (c) WhatsApp (needs a WhatsApp Business setup and approved message templates). Not built; waiting on Totty.
7. **Follow-up calls**: follow-ups are texts today. For parents who prefer calls, should a follow-up be a call, and should it fall back to a text? (Needs the voice milestone.)
8. **Check-in booking**: the text carries a booking link; which scheduling tool does the link point to, and how and where does the parent pay (in the link, or separately)? Is it only the one text, or a reminder if they do not respond?