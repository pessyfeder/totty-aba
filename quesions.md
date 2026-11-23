* Pricing:

  * Long prompts cost two segments. approx half cent per segment depending on recepient's network provider. A segment is 160 characters. Rating prompts include “Reply 0-5 (5 = best). You can add a comment…”, so they will often run past 160 and be billed as two. Shortening that wording would cut the cost.
  * Follow-ups multiply the cost. The worst case is 4 outbound texts per prompt (the prompt plus 3 follow-ups), plus the parent’s reply. At 40 prompts a day with every follow-up sent, that’s about 160 texts a day. That comes to roughly $60 a month on Twilio and $40 on Telnyx, before two-segment prompts and replies. Real usage should be well below that, because a reply stops the follow-ups.
  * Calls would cost more per attempt. A call to a 1-minute prompt is around $0.014 on Twilio and $0.007 on Telnyx. Both are cheap per call, but a follow-up call every 30 minutes adds up in the same way.
  * Switching providers is mostly one file. Texts only touch messaging.js and the inbound webhook. Calls are different on each platform, so it’s better to choose before building voice.
* if database is linked to the app, how do clients enter their info? through the website? can the two be linked? 
google calendar to schedule appointments?
main question: what happens after a client reaches out?

  * you want to be able to send them a form which they complete and then upload that to the app.

## Resolved (see SPEC.md)
* Clients enter their info through the online intake form (`/intake`); no PDF upload (5.1a).
* Google Calendar is not used. Appointments are booked in the website's scheduling portal and entered by hand in the app (5.7b, questions 9, 10, 16).
* After a client reaches out: intake form, consultation email, consultation, Start baseline, weekly check-ins (5.1a).
* Meeting outcomes: a note on the appointment (5.7b, question 15).
* Pricing notes above are stale: calls were dropped and Telnyx is the provider (SPEC question 1a).


## Open
* Which scheduling portal does the website use, and can it send webhooks? If it can, build the automatic booking path alongside manual entry. Match a booking to a client by the booker's email against contact emails, and put non-matches in an Unmatched bookings list. Check: webhook events (booking, reschedule, cancel), the fields sent (booker email, time, service type), API or CSV export as a fallback, whether the confirmation message can be edited, and whether the plan or payment provider limits webhooks (SPEC questions 9, 10, 16; 5.7b).
