# BTB - Behavior Treating Behavior: Product Spec (v0.1 draft)

## 1. Overview
A web app for Totty, a BCBA, to track client progress on behavioral goals. Parents report on each goal by one of three methods: SMS at scheduled times, a once-a-day email listing all goals, or a paper log that Totty enters into the app (see 5.4b). Their answers feed per-goal charts, and Totty can create a progress report for any client on demand. Nothing is sent during Shabbos (see 5.3).

## 2. Users
| Role | Description | Access |
|---|---|---|
| Totty (BCBA, admin) | Manages clients, goals, schedules, and reports | Full web app, password login |
| Parent / caregiver | Answers prompts and receives bi-weekly reports | SMS, the daily email, or a paper log (5.4b); no login in v1 |

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
- **Contact**: a parent/caregiver for a client; has a phone number and an email, and logs by SMS, the daily email, or paper (5.4b).
- **Goal**: a target behavior for a client, with a response type and a schedule.
- **Prompt**: one scheduled ask for a goal on a given date/time.
- **Response**: a parent's answer to a prompt.

## 5. Functional requirements

### 5.1 Client management
- **Clients are created in one of two ways:** (1) a family submits the online intake form (5.1a), or (2) Totty adds the client himself with the **Add client** button on the client list (5.1b), for example for a family who cannot use the website or a client who predates the app. There is no PDF upload. Totty edits and archives all clients, however they arrived.
- **Contacts pane**: parent/caregiver contact details are added and edited on a separate **Contacts** page (client page > Edit contacts), not inline with goals. Editable: name, relationship, mobile (international format), email, preferred channel, language, status (active, paused, ended), consent to texts/email, and a consent note. The consent date is recorded when consent is first ticked and kept while it stays ticked. Pausing or ending a contact stops all prompts to that person. Contacts are not deleted.
- **Editing**: the client page has an **Edit** button that opens a form with every client field, pre-filled. Every client field is editable, including name, gender, DOB, admission date, location, timezone, Israel/Yom Tov setting, candle-lighting offset, and notes. Optional fields can be cleared. Required fields (name, admission date, location, timezone) cannot be left blank. Each edit is recorded in the audit log (which fields changed).
- A location or timezone change takes effect for the Shabbos window immediately: every send is checked against the client's current location when it is due, including prompts already scheduled. Send times of prompts already created keep their original instant; newly created prompts use the new timezone.
- **Archiving**: **Archive client** (on the edit page, after confirmation) stops all prompts for the client and removes them from the dashboard and client list. History and charts are kept. The dashboard links to an **Archived clients** list; opening a client there leads to its edit page, where **Restore client** is offered. An archived client can be restored, which resumes prompts from the next scheduled slot (missed slots are not backfilled).
- Each client has an **admission date** (date admitted to Totty's services), set to the date the intake form is submitted (Totty can edit it).
- Client page shows: first and last name, gender, age, DOB, admission date, parent/caregiver names, phone(s), email, preferred channel, language, notes, and the list of goals with a chart each.
- Client list with search and an "attention needed" flag (e.g., 3 or more missed responses in the last 14 days, or a declining trend).

### 5.1a Client intake flow
How a new client gets from first contact to active prompts. **The normal path is the online intake form; Totty can also add a client manually (5.1b).** The app takes no uploaded PDFs or documents. Once the form is submitted (or the client is added), Totty starts the app.

1. **Inquiry**: the family reaches out through the website. Totty follows up by talk, text or his own email and gives them the link to the **online intake form** (`/intake` on `PUBLIC_URL`, or the link set in Settings under **Intake**; the family picks the New Jersey or New York section inside the form). The app creates nothing and sends nothing at this step. **The form is the first step for everyone, including families who start from the website:** both **Schedule Consultation** buttons on the website link to the online intake form, not straight to a booking page, so no consultation is booked before a client exists. **The top of the intake form page carries this notice: "In order to schedule a consultation, first fill out this intake form."** so a family arriving from a Schedule Consultation button knows why they are on a form and not a calendar. The portal's confirmation message **cannot be edited**, so it cannot carry the intake form link. A family who reaches the booking page another way is not redirected to the form: Totty gives the link to anyone who books without having submitted it, and until the form is submitted there is no client to attach the booking to.
2. **Online intake form**: a public page, no login. It follows the paper packet: client and family information, communication preferences (language), informed consent for services, fee and cancellation policy, background and history, **preference assessment**, optional release of information, and the **location consent** with the NJ or NY eligibility attestation. Signatures and initials are typed. Card details are not collected. **A parent must sign every required consent, including the informed consent and the location consent, before Submit is accepted**; the form and the server both refuse a submission without it. The form does **not** collect the goal-logging method, the consent to texts/email or the session logistics (frequency, phone or video) or the Crisis & Emergency Response (H.O.P.) sheet: those belong to the Initial Consultation Form (step 4).
3. **Client created**: on Submit the app stores the submission, **creates the client** (name, DOB, gender, location, parent/caregiver contacts, language, preferred channel, notes) and records the informed consent (who signed and when, shown on the client page). No consent to texts or email is recorded at this point. The status is **information submitted**. Nothing is contacted automatically. The page shown after Submit tells the family the form was received and carries the consultation booking link (`CONSULT_BOOKING_URL`), so they can book right away; the consultation email (below) carries the same link.
4. **Consultation**: the family books a consultation through the website's scheduling portal (link in the consult email). The meeting happens, where Totty and the family discuss goals and reinforcements, guided by the **Initial Consultation Form** (what the first session covers, priority goal, the family's **preferred logging method** (text message, daily email or paper log) with how each works, what happens after baseline, **How Sessions Work** (45-minute remote sessions, preferred frequency, phone or video, what to have ready, rescheduling) and the **Consent to Text / Email**, which the parent signs there). Totty then records the logging method and the consent on the Contacts page; no prompt is sent until consent is recorded. Baseline data is tracked in the app, not on a paper log.
5. **Enter meeting outcomes**: the goals and preferred reinforcements (5.2, 5.6a) agreed in the meeting are entered into the app, either manually by Totty or automatically (e.g., from meeting notes), always with Totty's review before saving.
6. **Start baseline**: Totty presses **Start baseline** on the client (this replaces the former Go button). From then on the app takes over: prompts are scheduled and sent per the goals' schedules, subject to the Shabbos/quiet-hours rules and each contact's recorded consent. Until then, no prompt is sent to the family.
7. **Ongoing meetings**: a link to the **website's appointment scheduling portal** lets the family schedule and pay for meetings with Totty; the website handles appointments and payment. The link is embedded in the weekly check-in text (every 7 days, 5.7a) when the parent answered every prompt that week; otherwise the text tells them to contact Yisroel Feder and carries no link. It is `CHECKIN_BOOKING_URL`.

Notes:
- **Client status flow** (`intake_status`): **information submitted** (`information_submitted`, set when the parent submits the form) → **baseline** → **active**. The app prompts Yisroel at each step (the client page shows the next step, the dashboard lists emails waiting for approval):
  1. *Online form*: see steps 1 to 3 above. Every submission creates a client; there is no general-link waiting list and no copying into an existing client. A manually added client (5.1b) enters the same flow at *information submitted* and continues from step 2.
  2. *Information submitted*: the app drafts the **initial consultation email** (booking link plus the attached document explaining what the consultation covers). Yisroel approves and sends it.
  3. At the consultation Yisroel sets the goals and plan and presses **Start baseline**: status becomes *baseline* and prompts start going to the parents.
  4. After **one week** the parent gets the check-in text (5.7a, then every 7 days). If they answered **all** of the last 7 days' prompts, it invites them to book the first check-in appointment; if not, it tells them to reach out to Yisroel Feder and they cannot book.
  5. When that first check-in appointment has passed, the client becomes *active* automatically (Yisroel can also mark it by hand from baseline).
  Prompts go to `baseline` and `active` clients; never before baseline starts.
- **Decisions**: the intake form is the **online page built into the app** (`/intake`); there is no fillable PDF, no PDF upload and no form-hosting service. Booking links (consultation and ongoing meetings) point to the **website's appointment scheduling portal**, which handles appointments and payment (the intake form's fee section states that payment is due upon scheduling an appointment; there is no "at time of session" or "other" payment-due choice); the app does not create bookings or links itself, it stores the URLs in Settings (`CONSULT_BOOKING_URL`, `CHECKIN_BOOKING_URL`; the intake form link is not stored in Settings) and includes them in messages.
- Intake data is PHI and follows the same privacy rules as section 8. Submissions are stored encrypted and are not included in SMS.

### 5.1b Manual client add
Totty can create a client without the online form. This is an addition to the form path in 5.1a, not a replacement; the form stays the default and what the website buttons link to.
- **Add client** button on the client list opens a form with the same fields as the client Edit form (5.1): first and last name, gender, DOB, admission date (defaults to today), location, timezone, Israel/Yom Tov setting, candle-lighting offset and notes. Name, admission date, location and timezone are required. At least one parent/caregiver contact (name, relationship, mobile, email, language, preferred channel) can be entered; further contacts are added on the Contacts page.
- **Status**: the client starts at *information submitted* (`information_submitted`) and follows the normal flow (consultation, **Start baseline**, baseline, active). For an existing client already past those steps, Totty can set the starting status to *baseline* or *active* when adding.
- **No consents are implied.** A manually added client has no signed informed consent on record and no consent to texts or email. Totty records the informed consent (who signed, date, and how: paper or verbal) and the text/email consent on the client and Contacts pages. **No prompt is sent until text/email consent is recorded**, exactly as in 5.1a.
- **No automatic consultation email.** The consultation email draft (5.7b) is created only when a family submits the form, so a manual add drafts nothing and sends nothing. Totty can send the intake form link himself if he wants the full form completed.
- Creation is recorded in the audit log, marked as a manual add. A manually added client is otherwise identical to a form client: edit, archive, restore, goals, charts and reports all work the same.
- Intake data entered this way is PHI and follows section 8.

### 5.2 Goals
Each goal has:
- Title and description (e.g., "Uses a spoon independently at dinner").
- **Response type** (one per goal):
  - `yes_no`: parent replies Y or N.
  - `duration`: parent replies with a number of minutes (e.g., `15`), meaning how long the behavior lasted or the activity took. The reply is a plain number only.
- **Schedule**: days of week and a time of day (client's local timezone). Can be daily, specific days, or weekly.
- **Contact** to prompt. Prompts go by SMS, or by the daily email if the contact uses that method; a contact who logs on paper gets no goal prompts (5.4b).
- **Date added**: the date the goal was added to the client's plan. Defaults to today on creation (Totty may set it when adding the goal) and is shown on the goal and its chart.
- Start date (first prompt date, may differ from date added), optional end date, status (active, paused, archived).
- **Goals are add-and-archive only.** Once added, a goal's title, question, schedule, contact, type, dates and target cannot be edited, so its chart and history always mean what they said when the data was collected. To change a goal, Totty archives it and adds a new one. The only changes allowed on an existing goal are **Pause/Resume** (prompts stop while paused) and **Archive**. Archiving asks for confirmation, stops all prompts, cannot be undone, and keeps the goal's history and chart, which appear under "Archived goals" on the client page. Chart notes (5.5) can still be added to active goals.
- Optional target criterion (e.g., "80% Y over 2 weeks", or "average at least 4") used for the chart target line and an "achieved" suggestion.

### 5.3 Shabbos / no-send rule
- No SMS or email is ever sent from Friday at candle lighting until Saturday nightfall (tzeis hakochavim).
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

**Reminders and retries**
- **Follow-ups**: if there is no reply 2 hours after the prompt (`followup_after_minutes`, default 120), send one follow-up text ("Reminder: ..." with the same question). If there is still no reply, send one catch-up text the next morning, when quiet hours end (`followup_catchup_morning`, default on), for at most **2 follow-ups** (`max_followups`). A reply at any point stops them. Follow-ups are never sent in quiet hours or a Shabbos/Yom Tov window, and a follow-up that could not be sent is dropped, not queued. The prompt becomes `no_response` once the catch-up has gone out, or at the end of the next local day if it could not be sent.
- Late replies (up to 24h) are still accepted and attached to the original prompt's date.

### 5.4b Parent logging methods
Each contact logs goal data by **one** of three methods: **text message**, **email** or **paper**. The family states its preference at the initial consultation (the Initial Consultation Form has a "preferred logging method" choice, 5.1a), and Totty records it on the Contacts page (`logging_method`). All three methods feed the same `response` records, charts and reports.

**A) SMS messages** (as in 5.4): one text per goal at its scheduled time, answered Y/N or minutes, with follow-ups. This is the default.

**B) One email per day, all goals, answered at once**
- The contact gets **one email per day** (at a daily send time, default 7pm local, set in Settings) that lists **every goal due that day** for the client, each with its question, plus a **link** to a single private answer page. Only goals scheduled for that day are included; if none are due, no email is sent.
- **The parent responds to all goals at once**: the answer page shows every goal with a Yes/No choice or a minutes box, and one **Submit** records all answers together. Goals may be left blank and answered later from the same link. The link needs no login; it is unguessable, specific to that contact and day, and stays open for 24 hours after the email, like late replies in 5.4.
- **Responses upload to the app automatically** on submit: each answer is saved as a response on that goal's prompt for that day (`source = 'email'`), using the same value rules as SMS (yes/no, or whole minutes, `0` valid, limit 1440). A re-submit before the link expires replaces the earlier answer for that goal. Totty does nothing to import them.
- The email carries the child's first name and the goal questions only, with no other PHI, no diagnosis and no progress data. Requires a contact email and recorded consent that covers email.
- **Reminders**: one reminder email the next morning (quiet hours end) for goals still unanswered, then none. Unanswered goals become `no_response` when the link expires.
- Obeys the same rules as texts: never sent in a Shabbos/Yom Tov window or quiet hours (queued and sent at the next permitted time), only to active contacts and active clients, logged in the message log. An email that bounces is flagged on the contact: a hard bounce (a permanent SMTP rejection at send time, or a hard-bounce notice posted by the provider to `/webhooks/email/bounce?token=<EMAIL_WEBHOOK_SECRET>`; generic, Postmark and SendGrid formats) sets `email_bounced_at` and a reason, shows a warning on the client and Contacts pages, and is logged. Soft bounces are logged only. No further check-in emails go to a flagged address; editing the contact's email clears the flag.
- Email delivery uses a transactional email provider that will sign a BAA (open question 12). The provider's inbound email is not used: answers come only through the answer page.

**C) Paper log**
- The contact records answers on a paper log Totty gives them (one row per goal, one column per day: Y/N, or minutes). **No goal prompts, follow-ups or daily emails are sent** for these goals, and no prompts are created for them. The family still gets the **weekly appointment email** (5.7a).
- The family brings the completed log to a check-in. Totty enters the answers into the app by hand (the manual data entry in 5.5, with `source = 'paper'`; Y/N or minutes under the same value rules, `0` valid, limit 1440). Each entry is recorded in the audit log.
- Days not entered show as **no response**, never as No (5.5). Entries can be made for past days at any time.
- **Weekly appointment email**: a paper contact gets the weekly check-in as an **email** (not a text) inviting them to schedule an appointment, with the booking link, every 7 days (5.7a). It requires a contact email and recorded consent that covers email; without them, Totty reaches the family himself.
- Report links (5.6) are unchanged: they still go by text to a paper contact who has a mobile number and recorded text consent.
- Goals on the paper method are still add-and-archive only (5.2). Changing a contact's method affects only prompts created afterward.

### 5.4c Call-in line with a robot secretary (proposed, not built)
For families with **no internet** (no smartphone or computer, or no comfort with the website). The robot secretary does **two things only: intake and appointment scheduling**. It does **not** collect goal data: those families log by SMS or paper (5.4b), and the robot never asks about goals, progress or clinical matters. This also answers open question 11 for clients who cannot use the intake form or the scheduling portal.
- **Inbound only.** The practice gets one **call-in number** (a Telnyx voice number, the same vendor as SMS). The family calls it at any time. **The app never places calls**, so the decision in question 4 stands (no outbound voice). Because the caller starts the call, it works on Shabbos/Yom Tov the way inbound texts do (5.3): nothing is sent and nothing needs Totty.
- **Intake by phone**: a new caller is walked through the same questions as the online intake form (5.1a) (client and family information, language, and the other fields the form collects), by keypad and speech with each answer read back to confirm. The call creates the client at *information submitted* exactly as the form does, marked as created by phone. No audio is kept; only the answers.
  - **Consents**: the robot reads each required consent (informed consent, location consent) and the parent says "I agree". This is recorded as a **verbal consent** (who, date, and how: phone), as in 5.1b. Totty reviews and may follow up for a written signature. No consent to texts or email is recorded, and none is part of this call. *Open (question 19):* whether a verbal agreement to a robot is acceptable for the informed consent.
  - If the caller's number matches an existing contact, the robot does not create a second client; it offers appointment scheduling for the existing client.
- **Appointment scheduling**: the robot identifies the caller by **caller ID matched to an active contact's phone** (or asks for the child's name and birth date if unknown), then takes an **appointment request**: type (consultation or check-in) and preferred days and times. It does not book or take payment itself (booking and payment belong to the website portal, 5.1a). Totty gets the request on the dashboard, books the family himself and enters the appointment by hand (5.7b, `source = 'manual'`), then calls or texts the family to confirm. Until confirmed, the request does not count as an appointment for the check-in skip rule (5.7a).
- **Leave a message**: any caller can leave a short message for Totty, who returns the call himself.
- **Privacy**: call audio is **not recorded or stored**. Only the answers, the call time, caller number and outcome are stored, and written to the message log; a message left for Totty is kept as text or audio, with the caller told first. It is PHI (section 8). The voice vendor must sign a BAA (question 1a).
- No new logging method and no contact PIN are needed. The `phone` contact fields from the earlier draft are dropped.

### 5.5 Charts and progress
- Per goal, a chart over a selectable range (1 week, 1 month, 3 months, all):
  - `yes_no`: percent met per week plus a daily dot strip (Y/N/no response).
  - `duration`: line or bars of daily minutes with a moving average, and the weekly average and total.
- Target line and phase-change markers (Totty can annotate a date, e.g., "new intervention started").
- Missing responses shown distinctly, never counted as N.
- Client overview page shows all goal charts, with a summary of trend (improving, flat, declining).
- Totty can manually add or edit a data point (Y/N or minutes, no note needed; the change is recorded in the audit log), e.g., when a parent tells him by phone or hands in a paper log (5.4b, `source = 'paper'`).

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
- The dashboard is just the list of clients (new ones appear when a family submits the intake form) and a link to Archived clients. Each client links to the client page.
- A notice with the reopen time while a Shabbos / Yom Tov window is in effect. No notice about upcoming windows.
- Everything else lives on the client page: attention flags, today's prompts and their status (scheduled, sent, answered with the actual reply, no response), preferred reinforcements, goals, and progress charts.

### 5.7a Parent check-in prompt (weekly)
- **Seven days** after a parent first receives messages from the app, and then **every 7 days**, they get a check-in text. The text depends on that week's replies:
  - **Every prompt in the last 7 days was answered (100%)**: the text invites them to book a **check-in appointment with Yisroel Feder, BCBA, LBA** and carries the booking link.
  - **Any prompt was not answered**: the text tells them to **reach out to Yisroel Feder directly** instead. It carries no booking link, so the parent cannot book that week.
- The first seven days are counted from the first prompt actually sent to that contact (`first_message_at`), not from when the contact was created. Each check-in text goes out at the next permitted time after it is due and follows every send rule: never during Shabbos/Yom Tov, never in quiet hours, only to active contacts with recorded consent. If it cannot go out in a blocked window it is sent after the window ends (it is not dropped).
- After the first check-in, the 7 days are counted from the last check-in text sent to that contact (`checkin_last_sent_at`). "Answered" counts the prompts sent to that contact in the 7 days before the text is due. Only active clients and active contacts receive it; a paused contact gets none and, when resumed, gets the next one at the next permitted time rather than a backlog. It is logged in the message log like any other message.
- **Skip when already booked**: if the client already has a future appointment (5.7b) when the text is due, the text is skipped for that cycle and `checkin_last_sent_at` is not advanced, so the next check happens at the next permitted time after that appointment has passed. A booking that cannot be matched to a client does not count, so the text is still sent.
- The text contains no progress details, only the child's first name and the invitation to schedule.
- **Paper-log contacts** (5.4b C) get this check-in **by email** instead of text. They receive no goal prompts, so there is no answer rate to check: the email **always carries the booking link**, never the "reach out" variant. The first one is due 7 days after baseline starts (or after the contact is switched to paper, if later), then every 7 days from `checkin_last_sent_at`. Skip-when-booked, the send rules (no Shabbos/Yom Tov, no quiet hours, active contacts and clients only, consent required), message-log entry and bounce flagging all apply as for other emails. Same wording and no progress details. *Built:* `contact.logging_method` (`sms` default, `email`, `paper`; set on the Contacts page) and `logging_method_changed_at` (stamped by a trigger whenever the method changes) anchor the first email; the scheduler tick sends it (`sendPaperCheckinEmails`) through the same mailer as the other emails and writes it to the message log. Paper contacts get no prompts from `generatePrompts` and no check-in text. Bounce flagging is not built (no inbound bounce handling exists yet).
- **The booking text includes a link to book the appointment** (a scheduling link, stored in Settings as `CHECKIN_BOOKING_URL`; the website's scheduling portal handles both the appointment and payment, so the text carries no separate payment reminder). Example: "Time to schedule a check-in for <first name> with Yisroel Feder, BCBA, LBA: <link>. You can book and pay for your appointment there."
- **The reach-out text has no link.** Example: "Please reach out to Yisroel Feder, BCBA, LBA, about <first name>'s check-in." The booking link is withheld until a week in which every prompt was answered.

### 5.7b Appointments
Appointments are booked, and paid for, in the website's scheduling portal (the booking links in the consultation email and check-in text point to it); the app records and shows them so Totty sees what is coming. **There is no Google Calendar integration.** **How bookings reach the app (decided):** Totty enters each appointment by hand on the client page (**Add appointment**: type, date/time, optional note; `source = 'manual'`), usually from the portal's booking notification. This is the v1 path and also covers clients who book by phone or cannot use the portal (question 11). The app never creates bookings itself and reads no email. If the portal later offers a webhook or API, a token-protected `POST /webhooks/booking?token=<BOOKING_WEBHOOK_SECRET>` can create appointments with `source = 'portal'`, matched to a client by the booker's email against contact emails; an unmatched booking goes to an **Unmatched bookings** list on the dashboard for Totty to assign, and never counts toward the check-in skip rule until assigned. Nothing else changes when that is added. Each appointment has a **client** and an **appointment type**: `consultation`, `check-in`, `ongoing meeting` (extend as needed).

How they arise:
- **Clients arrive through the online intake form** (5.1a) **or are added manually by Totty** (5.1b). Nothing is uploaded, and no appointment is booked or entered at that point.
- **Client responds**: when the parent submits the form, the app **automatically** creates the client with status `information_submitted`, fills in the info fields (name, DOB, gender, location, contacts, language, preferred channel, notes) and records the signed informed consent (5.1a step 3). Consent for texts and email is not part of the form; it is signed on the Initial Consultation Form and recorded by Totty on the Contacts page.
- **Automatic, initial consult email**: once intake paperwork is received (status `information_submitted`), the app emails the family the consultation booking link (`CONSULT_BOOKING_URL`). Totty reviews/approves the first send; the email carries no clinical detail (child's first name only). *Built:* reaching `information_submitted` (by the parent's Submit) drafts one email per client, addressed to the first active contact with an email address. The client page shows the exact text with **Approve and send** / **Decline**, and the dashboard lists drafts awaiting approval. Approval needs `CONSULT_BOOKING_URL` and a contact email. An approved email goes out at once, except during the recipient's Shabbos / Yom Tov window, when the scheduler tick sends it after nightfall. It is dropped if the client has moved past `information_submitted`, and a failing send is retried up to 3 times before showing the error. Email goes through SMTP (`SMTP_URL`, `EMAIL_FROM`); in development it prints to the console.
- **Automatic, weekly check-in text**: see 5.7a; when every prompt was answered it carries the booking link (`CHECKIN_BOOKING_URL`) (5.1a step 7).

**Meeting outcomes (decided):** the record of a meeting lives on its appointment. After a meeting Totty opens the appointment and presses **Mark held**, which sets status `held` and offers an **outcome note** (short free text: what was reviewed, what changed, next steps; `appointment.outcome_note`, `held_at`). Goal and reinforcement changes made at the meeting are still made on the goals and reinforcements themselves (add-and-archive, 5.2; 5.6a) and appear in the audit log; the note is the human summary. The note is PHI, is never sent by SMS or email, and is shown on the client page beside the appointment. Meeting information is **not** included in PDF reports in v1. A structured meeting record that feeds reports (date, decisions, goal changes) is a later option built on the same fields. The app never ingests Totty's own clinical notes: he types the outcome note, or leaves it blank.
- **Initial consultation**: scope is goals, reinforcements, priority goal, how goal logging works, and what happens after baseline. Totty enters the agreed goals and reinforcements (5.1a step 5) and marks the appointment held.
- **First meeting after baseline**: Totty reviews the 7 days of baseline data with the family. The existing **Create report** with a custom period covers the baseline summary, so no new report type is needed. Because goals cannot be edited (5.2), targets are set by archiving and re-adding the goal with its target.
- **Weekly check-ins**: used to review progress, adjust goals or reinforcements, and add new goals. The app supports these only through the existing goal and reinforcement screens plus the outcome note.

Visibility for Totty:
- The dashboard shows an **Upcoming appointments** list: date/time, client name, appointment type.
- The client page shows that client's appointments (upcoming and past) with type, and which automatic message invited them.
- Appointment details are PHI (section 8) and never appear in SMS.

### 5.8 Settings
- Location and timezone, Shabbos/Yom Tov rules, quiet hours (e.g., no messages before 8am or after 9pm), daily email send time (5.4b), sender number, report options, follow-up timing and limit (defaults 2 hours, then a next-morning catch-up; 2 follow-ups).

## 6. Data model (draft)
- `clinician(id, name, email, password_hash, timezone, location, settings_json)`
- `client(id, clinician_id, first_name, last_name, gender, age, dob, admission_date, notes, location, timezone, status, intake_status, activated_at, consent_signed_at, consent_signed_by)`
- `appointment(id, client_id, type, starts_at, status ('scheduled' | 'held' | 'missed' | 'cancelled'), source ('manual' | 'portal'), notes, outcome_note, held_at, created_at)`
- `reinforcement(id, client_id, name, note)`
- `contact(id, client_id, name, relationship, phone, email, preferred_channel, logging_method ('sms' | 'email' | 'paper'), language, first_message_at, checkin_last_sent_at)`
- `daily_email(id, contact_id, local_date, token_hash, sent_at, expires_at, submitted_at)` (one per contact per day; its prompts are linked to it)
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
- **Messaging**: Telnyx (SMS) with inbound webhooks (Ed25519-signed) and delivery-status webhooks. SMS is built (`POST /webhooks/telnyx/sms`, `telnyxProvider`). **Outbound** voice calls are not part of the product. The only voice feature is the **inbound call-in line** with a robot secretary for intake and appointment requests (5.4c, proposed): a Telnyx voice number with a webhook that runs the call flow. Not built.
- **Zmanim**: a library such as KosherZmanim, using lat/long and timezone.
- **PDF**: server-side HTML-to-PDF.
- **Auth**: session or JWT login for Totty; webhooks verified with provider signatures.
- **Hosting**: any small HTTPS host; secrets in environment variables.

## 8. Non-functional requirements
- **Privacy / compliance**: this is health-related information about children. Treat as PHI. Encrypt in transit and at rest, minimize PHI in SMS (first name or initials only, no diagnosis), keep audit logs, and obtain written parent consent to text or email. HIPAA applicability and a BAA with vendors (Telnyx; confirm it will sign one and what it covers) need confirmation.
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
11. A contact whose first prompt was sent 7 days ago receives a check-in text at a permitted time (not during Shabbos or quiet hours), and again every 7 days after the last one. If all of the last 7 days' prompts were answered, the text has the booking link for Yisroel Feder, BCBA, LBA; otherwise it tells the parent to reach out to him and has no link. A paper-log contact instead gets the check-in by email every 7 days, always with the booking link, and no goal prompts.
12. Submitting the intake form without the signed consents is refused, with a message naming what is missing. A submission with them creates the client with the informed consent recorded and no text/email consent yet.
13. (Proposed, 5.4c) A new caller completes intake by phone and a client is created at *information submitted* with the verbal consents recorded and marked as by phone. A known caller asks for an appointment and Totty sees the request on the dashboard. The robot never asks about goals, and the app places no outbound call at any time, including on Shabbos.

**Appointments (5.7b), built:** Add appointment on the client page (type, date/time, optional note), the Upcoming appointments list on the dashboard, Mark held with an outcome note (client page and appointment page), status `scheduled | held | missed | cancelled` (`missed` = it was booked but did not happen; Mark held, Missed and Cancel are on each scheduled row; migration 025 turned old `completed` into `held`), and the check-in skip rule reading scheduled appointments. The booking webhook and Unmatched bookings list wait until the portal's capabilities are known.

## 10. Milestones
1. **MVP**: login, clients, contacts, goals, SMS yes/no + duration prompts, scheduler with Shabbos guard, per-goal charts.
2. **Client intake (5.1a)**: the public online intake form with required signed consents, which creates the client (plus Totty's manual **Add client**, 5.1b); intake status and **Start baseline** (no prompts until baseline starts), consultation and ongoing-meeting booking links (external scheduler URLs in Settings), entering goals and reinforcements from the meeting (by hand until the meeting-notes question is settled).
3. On-demand PDF reports (create, preview, edit, send).
4. Reminders and retries, dashboard, and daily email logging (5.4b).
4a. **Call-in line (5.4c, proposed)**: Telnyx voice number and robot secretary call flow for intake and appointment requests; appointment requests list on the dashboard.
5. Annotations, manual data entry, Yom Tov calendar, multi-clinician support.
6. **Cross-device app (later stage)**: Totty's app runs on both phone and computer. One responsive web app (installable to the phone home screen as a PWA) with a layout that adapts from phone to desktop, covering every Totty-facing screen: dashboard, clients, goals, charts, and report create/preview/edit. No separate native apps unless a later need (e.g. push notifications on iOS) requires it. The Shabbos lock applies the same on every device.

## 11. Open questions
0. **Intake (5.1a)**: partly resolved. Decided: intake is through the online form (no PDF, no upload), with a manual **Add client** option for Totty (5.1b); parents must sign their consent to submit; booking links go to the website's scheduling portal, which handles appointments and payment (the app stores URLs, does not create bookings). *Decided (see 5.7b):* meeting outcomes are entered by hand by Totty, as a note on the appointment; the app never ingests notes automatically. Fully resolved.
1. **Prompt volume**: *Working estimate:* about 40 prompts a day. A rough number is enough; it only affects cost and the combined-message design. At that volume, with every follow-up sent (3 outbound texts per prompt), the README estimates roughly $40 a month on Telnyx (about $60 on Twilio), before two-segment prompts and replies. Real usage should be lower, since a reply stops follow-ups.
1a. **Text-sending platform and costs**: *Decided: Telnyx* (SMS only), switched from Twilio. SMS is built against it. *Still open:* confirm Telnyx will sign a BAA and what it covers, US 10DLC registration and number approval. Costs to confirm: per-segment price, two-segment prompts, follow-up multiplier.
   *Open items before going live on Telnyx:*
   - [ ] Create the Telnyx messaging profile and number, and register for US 10DLC.
   - [ ] Copy the webhook public key from the Telnyx portal into `TELNYX_PUBLIC_KEY`.
   - [ ] Point the profile's webhook at `PUBLIC_URL/webhooks/telnyx/sms`.
   - [ ] Confirm Telnyx will sign a BAA (children's health data), and what it covers.
2. **Response type**: Y/N or minutes? Is the type chosen by Totty per goal, or should a goal ever allow both?
3. **Consent and HIPAA**: does Totty already have a parent consent process, and does he want the app built to HIPAA standard from day one?
4. **Voice calls**: *Decided:* the app never places calls (no outbound voice). *Added (proposed):* an **inbound** call-in line with a robot secretary for no-internet clients (5.4c); see question 19.
5. **Languages**: English only, or also Hebrew/Yiddish prompts?
6. **Parents on tablets and computers**: texts reach phones only. Do any parents need prompts on a tablet or computer? Options: (a) prompts also sent by email with a private link to a one-tap answer page that works on any device, no login (recommended; texts stay the default so basic and kosher phones keep working); (b) an installable parent web app with push notifications (needs a parent login, does not work on basic phones); (c) WhatsApp (needs a WhatsApp Business setup and approved message templates). Not built; waiting on Totty.
7. ~~Follow-up calls~~: dropped with voice calls (question 4).
8. **Check-in booking**: *Decided:* the text carries a link to the website's scheduling portal, which handles appointments and payment. Still open: is there a reminder if they do not respond?
9. **Appointments (5.7b)**: *Decided:* Google Calendar is not used. *Decided:* appointments are entered by hand for now; if the portal later posts a webhook, bookings match a client by the booker's email against contact emails, with an Unmatched bookings list for the rest (5.7b). Appointment types are `consultation`, `check-in`, `ongoing meeting`. *Decided:* the weekly check-in text is skipped for clients who already have a future appointment booked (5.7a).
10. **Booking app**: *Largely superseded:* the website's scheduling portal provides the booking links and handles payment. *Decided:* Totty enters bookings by hand in v1 (5.7b); an optional token-protected booking webhook is added only if the portal supports one. Reading email is rejected as fragile. *Still open (needs a look at the portal):* does it offer a webhook, API or CSV export, (*Answered:* its confirmation message cannot be edited, question 16)?
11. **Clients with no access to the website**: how do clients who cannot use the website scheduling portal (no internet or smartphone, or they are not comfortable with it) schedule and pay for appointments? Possibilities: they call or text Totty, who books for them; Totty enters the appointment by hand in the app; payment is taken separately. *Decided:* Totty books for them and enters the appointment by hand (5.7b, `source = 'manual'`); payment is taken separately. Such clients are logged by paper or SMS as usual, and can do intake and request appointments through the call-in line with a robot secretary (5.4c, proposed). *Still open:* whether the check-in text still goes to them (default: yes, it already carries no obligation to book).

11a. **Credit card portal link (intake form, Fee & Cancellation Policy)**: the intake form's note now links to The BTB Method's credit card processing portal instead of saying the practice will arrange a card on file. The link is a **placeholder** (`https://example.com/btb-credit-card-portal`, `public/info-page.js`). Still open: the real portal URL on The BTB Method's website.

12. **Daily email logging (5.4b)**: which email provider (it must sign a BAA, see question 3)? Is the answer-page link acceptable for PHI, or should the page ask for a second check (e.g., the child's birth year)? Does "uploads to app" mean parents submit on the answer page (as specced), or should Totty also be able to upload or paste responses by hand? Do parents on the email method also get the weekly check-in as an email instead of a text? Can one contact use more than one method? How is the paper log laid out and returned (a template Totty prints, or photos sent in)?
14. **Notes option in the reply text (5.4)**: should parents be able to add a "notes" comment when they reply to a prompt text? Currently a reply is only Y/N or a number of minutes, the app never asks for a comment, and any extra text is ignored (section 5.4). Options: keep as is; accept optional trailing text after the Y/N or number and save it as a note on that day's entry; or add a separate "notes" option (e.g., reply "NOTE") that prompts for a free-text comment. Needs deciding, along with whether notes show on the goal chart and in reports, and how they are stored (PHI, section 8).
15. **What happens at each meeting, and where results are recorded (5.1a, 5.7a)**: *Decided: option (b)*: a short outcome note per meeting on the `appointment` record, plus **Mark held** (5.7b). Goal changes stay in the goals and audit log; reports do not include meeting info in v1; the app never ingests Totty's notes. *Still open (Totty to confirm):* that these meeting purposes are right, and where he keeps clinical notes today (this does not block the build). Original question follows. The SPEC defines the initial consultation only as a discussion of goals and reinforcements guided by the Initial Consultation Form, and the check-in only as a text with a booking link (5.7a). It does not say what happens in the meetings or where their results live. The app has no meeting record: only goals and reinforcements Totty enters (step 5), the client `notes` field, the appointment `notes` field (`appointment.notes`) and the audit log. To settle:
   - **Initial consult**: confirm the scope (goals, reinforcements, priority goal, how goal logging works, what happens after baseline) and that its outcomes are entered by Totty (step 5).
   - **Baseline timing**: **Start baseline** (step 6) is what begins prompts, and the 7-day baseline period is counted from the first prompt sent (5.7a).
   - **First meeting after baseline**: presumably Totty reviews the 7 days of baseline data with the family and sets or confirms goal targets, reinforcement levels and prompt schedules. Confirm. If so, does the app need a baseline summary or report before the meeting, and a way to set targets afterward?
   - **Weekly check-ins**: what are they for (reviewing progress charts, adjusting goals or reinforcements, marking goals mastered, adding new goals, parent training)? Which of these changes should the app support?
   - **Where results are recorded**: (a) changes only, i.e. Totty edits goals and reinforcements and the audit log shows what changed (current behavior); (b) a short outcome note per meeting on the `appointment` record (depends on how bookings reach the app, questions 9 and 10); or (c) a structured meeting record (date, type, decisions, goal changes, next steps) that can feed the PDF reports.
   - **Where Totty keeps meeting notes today** (paper, a clinical record system, a document); this decides question 0 (whether the app ever ingests them).
   - **Reports**: should PDF reports include meeting information (e.g., "reviewed on <date>, changed X")? That would require (b) or (c).
16. **Website "Schedule Consultation" buttons (public site)**: the website has two **Schedule Consultation** buttons (the top navigation and the hero). *Decided (changed):* both buttons link to the **online intake form** (`/intake` on `PUBLIC_URL`), not to the booking page, so the form is always the first step and a booking never exists without a client (5.1a step 1). The intake page opens with the notice "In order to schedule a consultation, first fill out this intake form." The booking link (`CONSULT_BOOKING_URL`) is shown on the page after the form is submitted and in the consultation email. *Decided:* the portal's confirmation message cannot be edited, so there is no intake-link safety net there; Totty gives the link to anyone who books without having submitted it. The site holds the form link in one place in `btb-docs/index.html` (to be changed from the old `BOOKING_URL` placeholder when built). *Still open:* **the actual booking URL** (needed for `CONSULT_BOOKING_URL` in Settings), (the confirmation-message question is answered: it cannot be edited). *Decided:* the booking page is the website's scheduling portal, not Google Calendar, and it takes payment as for other appointments; bookings reach the app by hand entry (5.7b, questions 9 and 10).
17. **Accepted payment methods**: which payment methods are accepted (e.g., credit/debit card only, or also ACH/bank transfer, HSA/FSA cards, check, cash)? This decides what the intake form's Fee & Cancellation Policy says and what the credit card portal (question 11a) and the scheduling portal must support.
19. **Call-in line (5.4c)**: which voice/speech stack (Telnyx Voice with its speech tools, or a separate voice-AI vendor) and does it sign a BAA; keypad only or also speech; languages (English, Hebrew, Yiddish, question 5); is a verbal consent to a robot acceptable for the informed and location consents, or must a written signature follow; how an unknown caller is verified; whether messages for Totty are audio or transcribed; cost per call minute; and whether the robot should see Totty's availability and offer real slots (needs a calendar source, which the app does not have).
18. **Missed appointments (5.7b)**: what happens when a client does not show up, or Totty cannot attend? The app has no `missed` status: an appointment is `scheduled`, `held` or `cancelled`, and a meeting that did not happen is currently marked `cancelled` (existing `missed` rows were converted that way). Open: (a) is a no-show tracked separately from a cancellation (a `missed` status, or a reason on a cancelled appointment); (b) is a missed appointment rescheduled, and does the family get a text or email (the weekly check-in text is skipped only while a future `scheduled` appointment exists, so after a miss the next check-in text carries the booking link again); (c) is a late-cancel or no-show fee charged under the Fee & Cancellation Policy, and if so is it recorded in the app; (d) does a missed first check-in delay the client becoming Active (5.1a); (e) should Totty be reminded of past `scheduled` appointments never marked held (the client page shows "Did it happen?" today, the dashboard does not). Needs Totty's answer.
