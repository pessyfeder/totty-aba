# BTB - Behavior Treating Behavior: Product Spec (v0.1 draft)

## 1. Overview
A web app for Totty, a BCBA, to track client progress on behavioral goals. Parents report on each goal by SMS or phone call at scheduled times. Their answers feed per-goal charts, and Totty can create a progress report for any client on demand. Nothing is sent during Shabbos (see 5.3).

## 2. Users
| Role | Description | Access |
|---|---|---|
| Totty (BCBA, admin) | Manages clients, goals, schedules, and reports | Full web app, password login |
| Parent / caregiver | Answers prompts and receives bi-weekly reports | SMS/voice only, no login in v1 |

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
- Client list with search and an "attention needed" flag (e.g., 3 or more missed responses in the last 14 days, or a declining trend).

### 5.1a Client intake flow
How a new client gets from first contact to active prompts. Two tracks lead into the same client record, then Totty starts the app.

1. **Inquiry**: the client (family) reaches out through the website. Totty follows up by talk, text, or WhatsApp.
2. **Intake paperwork**: Totty sends an email with an intake form and a document request (e.g., consent, insurance, assessments). The family fills out the form and returns the documents.
3. **Auto-fill**: Totty uploads the returned form (and documents) to the app, which pre-fills a new client (name, DOB, gender, location, parent/guardian contacts, language, preferred channel, notes). Uploaded documents are attached to the client. The upload is manual; the fill that follows is automatic (see 5.7b for the empty-field and conflict rules); nothing is contacted automatically.
4. **Consultation**: the family books a consultation through the website's scheduling portal (link in the consult email). The meeting happens, where Totty and the family discuss goals and reinforcements.
5. **Enter meeting outcomes**: the goals and preferred reinforcements (5.2, 5.6a) agreed in the meeting are entered into the app, either manually by Totty or automatically (e.g., from meeting notes), always with Totty's review before saving.
6. **Go**: Totty presses a **Go** (activate) button on the client. From then on the app takes over: prompts are scheduled and sent per the goals' schedules, subject to the Shabbos/quiet-hours rules and each contact's recorded consent. Until Go is pressed, no prompt is sent to the family.
7. **Ongoing meetings**: a link to the **website's appointment scheduling portal** lets the family schedule and pay for meetings with Totty; the website handles appointments and payment. The link is embedded in the bi-weekly check-in text (every 14 days, 5.7a), so families can always book the next meeting. It is `CHECKIN_BOOKING_URL`.

Notes:
- A client has an intake status: `inquiry`, `paperwork_sent`, `paperwork_received`, `consult_scheduled`, `ready` (awaiting Go), `active`. Only `active` clients receive prompts.
- **Decisions**: the intake form is a **fillable PDF** that Totty attaches to his intake email (step 2; the app serves the blank form at `/api/intake/blank-form.pdf`); the family fills it in, and returns it with their documents by email, and Totty uploads it (step 3). The form is not built into the app and no form-hosting service is used; the app reads the PDF's form fields and pre-fills the client. The PDF's field names are fixed (client first/last name, date of birth, gender, location, notes, and per parent/guardian: name, relationship, phone, email, language, preferred channel). Booking links (consultation and ongoing meetings) point to the **website's appointment scheduling portal**, which handles appointments and payment; the app does not create bookings or links itself, it stores the URLs in Settings (`CONSULT_BOOKING_URL`, `CHECKIN_BOOKING_URL`; the intake form link is not stored in Settings) and includes them in messages.
- Intake data and documents are PHI and follow the same privacy rules as section 8. Documents are stored encrypted and are not included in SMS.

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
- Every unusable reply (unreadable, or a number above the limit) gets a follow-up message telling the parent it could not be read and asking them to try again ("Please reply Y or N" / "Please reply with a number of minutes, e.g. 15"), each time, with no retry limit. Nothing is stored or queued for Totty; the prompt stays open until a usable reply arrives.
- If several prompts are open for a contact, each message includes a short code (e.g., "Goal 2") and replies are matched to the most recent open prompt unless a code is given. A single combined message listing multiple goals is a later option.
- No opt-out feature in the app. A parent who wants prompts to stop speaks to Totty directly, and Totty pauses or ends the goal (or the contact) himself.

**Voice call**
- Automated call (text-to-speech): read the question, then accept either **keypad** or **spoken** input. Keypad: 1 = yes, 2 = no; or digits followed by # for minutes on a duration goal. Spoken: the parent says "yes" or "no", or a number of minutes ("fifteen", "15 minutes"), recognised with speech recognition in English only (no Hebrew or Yiddish recognition, for voice or text, since replies carry no comments). The prompt says both ways ("Press 1 or say yes; press 2 or say no").
- Spoken replies follow the same rules as SMS: only a yes/no or a number of minutes is kept, any extra words are ignored, `0` is valid, and values above the sanity limit (default 1440) are unusable. A reply is accepted immediately; the app reads back what it heard ("Got it, yes") and ends the goal's question.
- **Unusable input** (unrecognised speech, a key other than 1/2, or minutes above the limit): the call says it could not understand and asks again, up to 3 times in the same call. If still unusable, the call ends politely and the prompt stays open. A text follow-up ("Please reply Y or N" / "Please reply with a number of minutes, e.g. 15") is sent right away if the contact has a mobile number and it is permitted time, in line with the SMS rule that an unusable reply always gets a try-again follow-up. No input at all (silence) is repeated once, then treated as no answer.
- **Several open goals for one contact**: one call asks the goals one after another, in order, each by name ("Goal 1 of 3: Did Dovid use a spoon at dinner today?"). Each answer is recorded as soon as it is given, so hanging up part-way keeps the answered goals and leaves the rest open. Unanswered goals follow the retry policy below.
- **No answer / voicemail**: never leave a voicemail with PHI; if a machine answers, hang up and treat it as no answer. Retry per the retry policy (see below), then fall back to SMS if configured.

**Reminders and retries**
- **Follow-ups**: if there is no reply 2 hours after the prompt (`followup_after_minutes`, default 120), send one follow-up text ("Reminder: ..." with the same question). If there is still no reply, send one catch-up text the next morning, when quiet hours end (`followup_catchup_morning`, default on), for at most **2 follow-ups** (`max_followups`). A reply at any point stops them. Follow-ups are never sent in quiet hours or a Shabbos/Yom Tov window, and a follow-up that could not be sent is dropped, not queued. The prompt becomes `no_response` once the catch-up has gone out, or at the end of the next local day if it could not be sent.
- Follow-up by **voice call** (for contacts whose preferred channel is a call) arrives with voice prompts in milestone 4 (see 5.4a): the same timing and limit will apply, with the call replacing the text. Each follow-up call asks only the goals still open. An unanswered call counts as that follow-up; it does not add extra attempts beyond the 2 follow-ups. If the contact has a mobile number, a call follow-up that goes unanswered is also sent as a text, to avoid a silent miss. Calls obey the same Shabbos/Yom Tov and quiet-hours rules as texts, and a call that could not be placed is dropped, not queued. Spoken or keypad answers received on a late call are attached to the original prompt's date, like late text replies.
- Late replies (up to 24h) are still accepted and attached to the original prompt's date.

### 5.4a Voice calls: implementation scope (milestone 4)
*Status: not built. Today the scheduler handles `channel = 'sms'` only, so a goal set to `call` is never prompted. The database already allows `'call'` in `contact.preferred_channel`, `goal.channel`, `prompt.channel` and `response.source`, so no schema change is expected beyond retry bookkeeping.*

**Reused as is**: reply parsing (`parse.js`, including the 1440-minute limit), the Shabbos/Yom Tov guard and `message_log`, the webhook signature check (Telnyx Ed25519, `verifyTelnyxSignature`), and the rule that webhooks are never locked during Shabbos.

**To build**
1. **Dialer**: `placeCall({ to, promptIds })`, the call counterpart of the messenger. It goes through the same Shabbos refusal and logging (a refused call is logged, never placed), and has a console provider for development.
2. **Voice webhooks** returning TwiML, signature-verified and never locked: call answered, a keypad or spoken answer received, and call status (no-answer, busy, failed, completed). Per-call state (goals still open, try counter, silence counter) travels in the webhook URL, so no server session is needed.
3. **Call script** as in 5.4: each goal asked by name, `Gather` accepting keypad and English speech, read-back ("Got it, yes"), up to 3 unusable inputs, silence repeated once.
4. **Answer mapping**: keypad 1 = yes, 2 = no, digits then `#` = minutes; speech is turned into yes/no or a number (words such as "fifteen" included) and then goes through the same parsing as SMS. Each answer is saved the moment it is given, with `source = 'call'`.
5. **Machine detection**: if an answering machine is detected, hang up with no message and count it as no answer.
6. **Scheduler**: generate and send prompts for `channel = 'call'`. One call per contact covers all of that contact's open goals; call prompts due within about 10 minutes of each other are grouped into one call. Follow-up calls ask only the goals still open. An unanswered call counts as that follow-up, and if the contact has a mobile number a text goes out as well (on by default).
7. **Fallback texts**: the try-again text after 3 unusable inputs and the text for an unanswered call are sent only when permitted (not in a Shabbos/Yom Tov window, not in quiet hours).
8. **Tests**: run against the console dialer and simulated webhook posts, in the style of the existing flow tests, covering acceptance criterion 10a.

**Cannot be verified locally**: audio quality and speech recognition accuracy. These need real test calls on Telnyx before launch. Voice webhooks are built against Telnyx's TeXML (TwiML-style) or its Call Control API; confirm which fits speech and keypad `Gather` and answering-machine detection.

**Compliance**: recorded consent (`consent_given_at`) must cover automated calls and not only texts; written parent consent is already required in section 8.

### 5.5 Charts and progress
- Per goal, a chart over a selectable range (1 week, 1 month, 3 months, all):
  - `yes_no`: percent met per week plus a daily dot strip (Y/N/no response).
  - `duration`: line or bars of daily minutes with a moving average, and the weekly average and total.
- Target line and phase-change markers (Totty can annotate a date, e.g., "new intervention started").
- Missing responses shown distinctly, never counted as N.
- Client overview page shows all goal charts, with a summary of trend (improving, flat, declining).
- Totty can manually add or edit a data point (Y/N or minutes, no note needed; the change is recorded in the audit log), e.g., when a parent tells him by phone.

### 5.6 Progress reports
- Reports are created on demand: Totty clicks **Create report** on a client's page and picks a period: **bi-weekly** (14 days, two Sunday-Saturday weeks), **monthly** (calendar month), or **custom** (any start and end date). The default is the most recent completed 14 days. Nothing is generated or sent automatically.
- Contents: client name, date range, per-goal summary (responses received, % met or average minutes, change vs. prior period, small chart), Totty's optional note, and next-period focus.
- Totty previews and edits the report, then chooses **Send** or **Download PDF**. Sending is always a manual action.
- Delivery: the PDF is stored in the app and sent to the parent as an **SMS containing a secure link** (no email delivery). The link is unguessable and expires after a set period (default 14 days), and the text itself contains no progress details, only the child's first name. Reports can only be created or sent outside the Shabbos window; the app is locked for Totty during it (see 5.3).
- Report history is viewable per client (period, type, status, date sent).
- **How it works in v1:**
  - Period choices snap to whole periods: bi-weekly is always 14 days, Sunday to Saturday, monthly is a whole calendar month, custom allows up to one year. Create report builds a **draft** and opens the preview.
  - The report includes **every active goal**, even with no replies, plus any paused or archived goal that was asked something in the period. "Change vs. prior period" compares with the immediately preceding period of the same length.
  - Only answered prompts count: a day with no reply is shown as a missing mark and is never counted as No (5.5).
  - In the preview Totty can edit his note, the next-period focus, and a remark under each goal. Everything else is generated from the data and cannot be edited.
  - **Download PDF** produces the current draft without changing anything. **Send to parent** asks Totty to pick a contact (active, with a mobile number and recorded consent), confirms, then freezes the report, stores the PDF, and texts the link right away. A report that has been sent cannot be edited or sent again; to send updated figures Totty creates a new report.
  - The text reads: "A progress report for <first name> is ready: <link>". If the text cannot go out (including a Shabbos refusal), nothing is stored as sent and the report stays a draft.
  - The link opens the PDF with no login, until it expires (default 14 days, `REPORT_LINK_DAYS`). Only a hash of the token is stored. After expiry it shows a short "ask Totty for a new one" message. Opening the link is read-only, so it works during Shabbos; only Totty's actions are locked.
  - PDFs use standard Latin fonts: characters outside them (for example Hebrew in Totty's note or a remark) print as "?" in the PDF in v1.

### 5.6a Preferred reinforcements
- Each client has a simple list of **preferred reinforcements** (also called reinforcers), e.g., "bubbles", "iPad time", "gummy bears". It is a record only: no data collection, no scoring, and no chart.
- Each entry is a name and an optional note. Totty adds, edits, and removes entries.
- The list is shown on the client page.

### 5.7 Dashboard
- The dashboard is just the list of clients, with an **Add client** button and a link to Archived clients. Each client links to the client page.
- A notice with the reopen time while a Shabbos / Yom Tov window is in effect. No notice about upcoming windows.
- Everything else lives on the client page: attention flags, today's prompts and their status (scheduled, sent, answered with the actual reply, no response), preferred reinforcements, goals, and progress charts.

### 5.7a Parent check-in prompt (bi-weekly)
- Fourteen days (two weeks) after a parent first receives messages from the app, they get a text prompting them to set up a **check-in appointment with Yisroel Feder, BCBA, LBA**, and the same text repeats **every 14 days** after that, so families can always book the next meeting.
- The seven days are counted from the first prompt actually sent to that contact (`first_message_at`), not from when the contact was created. Each check-in text goes out at the next permitted time after it is due and follows every send rule: never during Shabbos/Yom Tov, never in quiet hours, only to active contacts with recorded consent. If it cannot go out in a blocked window it is sent after the window ends (it is not dropped).
- The 14 days are counted from the last check-in text sent to that contact (`checkin_last_sent_at`). Only active clients and active contacts receive it; a paused contact gets none and, when resumed, gets the next one at the next permitted time rather than a backlog. It is logged in the message log like any other message.
- **Skip when already booked**: if the client already has a future appointment (5.7b) when the text is due, the text is skipped for that cycle and `checkin_last_sent_at` is not advanced, so the next check happens at the next permitted time after that appointment has passed. A booking that cannot be matched to a client does not count, so the text is still sent.
- The text contains no progress details, only the child's first name and the invitation to schedule.
- **The text includes a link to book the appointment** (a scheduling link, stored in Settings as `CHECKIN_BOOKING_URL`) (a link to the website's scheduling portal, which handles both the appointment and payment, so the text carries no separate payment reminder). Example: "Time to schedule a check-in for <first name> with Yisroel Feder, BCBA, LBA: <link>. You can book and pay for your appointment there."

### 5.7b Appointments
Appointments are booked, and paid for, in the website's scheduling portal (the booking links in the consultation email and check-in text point to it); the app records and shows them so Totty sees what is coming. **There is no Google Calendar integration.** How booked appointments get from the website into the app is open (open question 10); the app never creates bookings itself. Each appointment has a **client** and an **appointment type**: `consultation`, `check-in`, `ongoing meeting` (extend as needed).

How they arise:
- **Manual, when a client reaches out**: Totty adds the client by hand (5.1a step 1) and sets the status to **reached out** (the `inquiry` intake status). Nothing else is recorded at this point: no appointment is booked or entered.
- **Manual, Totty emails the docs**: Totty sends the family an email with the intake form and document request (5.1a step 2), from his own email. The email is sent outside the app; the app does not send it. Totty then sets the client's status to **intake documents sent** (the `paperwork_sent` intake status). Nothing else is recorded.
- **Client responds**: the family returns the form and documents, and Totty uploads them to the client in the app (the upload is the manual part). On upload, the app **automatically** sets the status to `paperwork_received` and **fills in the client's info fields** from the submitted form (name, DOB, gender, location, contacts, language, preferred channel, notes). The documents are attached to the client. Intake info is normally filled **only** automatically; Totty does not enter it by hand. If he has entered some fields anyway, the app fills only the empty ones, and where the form's value conflicts with one he entered, the app leaves his value in place and shows an error message naming the field and both values, for Totty to resolve. The form is a **fillable PDF** (5.1a); the family returns the filled PDF and the app reads its form fields (one submission per file; a flattened, scanned or printed copy has no fields and is rejected with a clear message). Fixed field names in Totty's own PDF replace the guessing of question wording that a third-party form tool needed; documents (pdf, images, doc/docx, txt, up to 10 MB) are stored encrypted (`DOCUMENT_KEY`). A form never records parent consent to text/call.
- **Automatic, initial consult email**: once intake paperwork is received (status `paperwork_received`), the app emails the family the consultation booking link (`CONSULT_BOOKING_URL`). Totty reviews/approves the first send; the email carries no clinical detail (child's first name only). *Built:* reaching `paperwork_received` (by upload or by Totty setting the status) drafts one email per client, addressed to the first active contact with an email address. The client page shows the exact text with **Approve and send** / **Decline**, and the dashboard lists drafts awaiting approval. Approval needs `CONSULT_BOOKING_URL` and a contact email. An approved email goes out at once, except during the recipient's Shabbos / Yom Tov window, when the scheduler tick sends it after nightfall. It is dropped if the client has moved past `paperwork_received`, and a failing send is retried up to 3 times before showing the error. Email goes through SMTP (`SMTP_URL`, `EMAIL_FROM`); in development it prints to the console.
- **Automatic, bi-weekly check-in text**: see 5.7a; it carries the booking link (`CHECKIN_BOOKING_URL`) (5.1a step 7).

Visibility for Totty:
- The dashboard shows an **Upcoming appointments** list: date/time, client name, appointment type.
- The client page shows that client's appointments (upcoming and past) with type, and which automatic message invited them.
- Appointment details are PHI (section 8) and never appear in SMS.

### 5.8 Settings
- Location and timezone, Shabbos/Yom Tov rules, quiet hours (e.g., no messages before 8am or after 9pm), sender number, report options, follow-up timing and limit (defaults 2 hours, then a next-morning catch-up; 2 follow-ups).

## 6. Data model (draft)
- `clinician(id, name, email, password_hash, timezone, location, settings_json)`
- `client(id, clinician_id, first_name, last_name, gender, age, dob, admission_date, notes, location, timezone, status, intake_status, activated_at)`
- `appointment(id, client_id, type, starts_at, status, source, notes, created_at)`
- `reinforcement(id, client_id, name, note)`
- `contact(id, client_id, name, relationship, phone, email, preferred_channel, language, first_message_at, checkin_last_sent_at)`
- `goal(id, client_id, contact_id, title, description, response_type, channel, schedule_json, date_added, start_date, end_date, status, target_json)`
- `prompt(id, goal_id, scheduled_for, sent_at, channel, status, attempts, deferred_reason, followups_sent, last_followup_at)`
- `response(id, prompt_id, received_at, value_bool, value_minutes, raw_text, source, parse_status)`
- `annotation(id, goal_id, date, text)`
- `report(id, client_id, period_type, period_start, period_end, status, content_json, pdf_path, sent_at, note, link_token_hash, link_expires_at)`
- `message_log(id, direction, to_from, body, provider_id, status, created_at)`

## 7. Architecture (recommended)
- **Frontend**: React with a charting library such as Chart.js.
- **Backend**: Node.js (Express) or Python (FastAPI), REST/JSON API.
- **Database**: PostgreSQL. This is a production setup: managed hosting, automated backups, environment separation (staging and production), and monitoring.
- **Scheduler**: a persistent job queue (e.g., a database-backed queue or cron-style worker) that runs every minute, picks due prompts, checks the Shabbos guard, and sends.
- **Messaging**: Telnyx (SMS + Voice) with inbound webhooks (Ed25519-signed) and delivery-status webhooks. SMS is built (`POST /webhooks/telnyx/sms`, `telnyxProvider`); voice is milestone 4.
- **Zmanim**: a library such as KosherZmanim, using lat/long and timezone.
- **PDF**: server-side HTML-to-PDF.
- **Auth**: session or JWT login for Totty; webhooks verified with provider signatures.
- **Hosting**: any small HTTPS host; secrets in environment variables.

## 8. Non-functional requirements
- **Privacy / compliance**: this is health-related information about children. Treat as PHI. Encrypt in transit and at rest, minimize PHI in SMS (first name or initials only, no diagnosis), keep audit logs, and obtain written parent consent to text/call. HIPAA applicability and a BAA with vendors (Telnyx; confirm it will sign one and what it covers) need confirmation.
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
10a. On a voice call, saying "yes" or pressing 1 records true; saying "twenty minutes" or keying 20# records 20 minutes. Three unusable inputs in one call end the call, leave the prompt open, and send a try-again text. Hanging up after answering the first of three goals keeps that answer and leaves the other two open.
11. A contact whose first prompt was sent 14 days ago receives the check-in text with Yisroel Feder, BCBA, LBA at a permitted time (not during Shabbos or quiet hours), and again every 14 days after the last one.

## 10. Milestones
1. **MVP**: login, clients, contacts, goals, SMS yes/no + duration prompts, scheduler with Shabbos guard, per-goal charts.
2. **Client intake (5.1a)**: intake status and the **Go** button (no prompts until a client is active), manually importing external intake-form submissions and documents into a pre-filled new client, consultation and ongoing-meeting booking links (external scheduler URLs in Settings), entering goals and reinforcements from the meeting (by hand until the meeting-notes question is settled).
3. On-demand PDF reports (create, preview, edit, send).
4. Voice-call prompts, reminders and retries, dashboard. Scope in 5.4a.
5. Annotations, manual data entry, Yom Tov calendar, multi-clinician support.
6. **Cross-device app (later stage)**: Totty's app runs on both phone and computer. One responsive web app (installable to the phone home screen as a PWA) with a layout that adapts from phone to desktop, covering every Totty-facing screen: dashboard, clients, goals, charts, and report create/preview/edit. No separate native apps unless a later need (e.g. push notifications on iOS) requires it. The Shabbos lock applies the same on every device.

## 11. Open questions
0. **Intake (5.1a)**: partly resolved. Decided: the intake form is a **fillable PDF** (no form-hosting tool);  booking links to the website's scheduling portal, which handles appointments and payment (the app stores URLs, does not create bookings); the booking link is embedded in the bi-weekly check-in text (5.7a, every 14 days). Submissions reach the app when **Totty uploads the returned form and documents**; the app then sets `paperwork_received` and fills the client's info fields automatically (5.7b). An automatic webhook/email feed that skips the upload is a possible later step. **Still open**: whether meeting notes are entered by hand only or captured automatically.
1. **Prompt volume**: *Working estimate:* about 40 prompts a day. A rough number is enough; it only affects cost and the combined-message design. At that volume, with every follow-up sent (3 outbound texts per prompt), the README estimates roughly $40 a month on Telnyx (about $60 on Twilio), before two-segment prompts and replies. Real usage should be lower, since a reply stops follow-ups.
1a. **Text-sending platform and costs**: *Decided: Telnyx* (SMS and voice), switched from Twilio. SMS is built against it. *Still open:* confirm Telnyx will sign a BAA and what it covers, US 10DLC registration and number approval, and the voice API (TeXML or Call Control) before milestone 4. Costs to confirm: per-segment price, two-segment prompts, follow-up multiplier, per-call price.
   *Open items before going live on Telnyx:*
   - [ ] Create the Telnyx messaging profile and number, and register for US 10DLC.
   - [ ] Copy the webhook public key from the Telnyx portal into `TELNYX_PUBLIC_KEY`.
   - [ ] Point the profile's webhook at `PUBLIC_URL/webhooks/telnyx/sms`.
   - [ ] Confirm Telnyx will sign a BAA (children's health data), and what it covers.
2. **Response type**: Y/N or minutes? Is the type chosen by Totty per goal, or should a goal ever allow both?
3. **Consent and HIPAA**: does Totty already have a parent consent process, and does he want the app built to HIPAA standard from day one?
4. **Voice calls**: *Decided:* the app places automated calls and parents answer by keypad or speech, and the sending is automatic (no staff texting by hand). *Still open:* automated robot voice only, or could Totty ever want to be called in too? Scope in 5.4a.
5. **Languages**: English only, or also Hebrew/Yiddish prompts?
6. **Parents on tablets and computers**: texts reach phones only. Do any parents need prompts on a tablet or computer? Options: (a) prompts also sent by email with a private link to a one-tap answer page that works on any device, no login (recommended; texts stay the default so basic and kosher phones keep working); (b) an installable parent web app with push notifications (needs a parent login, does not work on basic phones); (c) WhatsApp (needs a WhatsApp Business setup and approved message templates). Not built; waiting on Totty.
7. **Follow-up calls**: follow-ups are texts today. For parents who prefer calls, should a follow-up be a call, and should it fall back to a text? *Proposed (5.4a):* yes to both, with the text fallback on by default for contacts that have a mobile number. Needs the voice milestone.
8. **Check-in booking**: *Decided:* the text carries a link to the website's scheduling portal, which handles appointments and payment. Still open: is there a reminder if they do not respond?
9. **Appointments (5.7b)**: *Decided:* Google Calendar is not used. Still open: how a booking is matched to a client (e.g., by the booker's email against contact emails), and what is the full list of appointment types. *Decided:* the bi-weekly check-in text is skipped for clients who already have a future appointment booked (5.7a).
10. **Booking app**: *Largely superseded:* the website's scheduling portal provides the booking links and handles payment. Still open: how the website's bookings reach the app (Google Calendar is not used). Options include a webhook or API from the website, an email notification the app reads, or Totty entering bookings by hand. The app only stores the links (`CONSULT_BOOKING_URL`, `CHECKIN_BOOKING_URL`), so this does not affect the rest of the build.
11. **Clients with no access to the website**: how do clients who cannot use the website scheduling portal (no internet or smartphone, or they are not comfortable with it) schedule and pay for appointments? Possibilities: they call or text Totty, who books for them; Totty enters the appointment by hand in the app; payment is taken separately. Needs deciding, along with how such appointments are recorded and whether the check-in text still goes to them.
