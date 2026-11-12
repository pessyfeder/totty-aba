* Pricing:

  * Long prompts cost two segments. approx half cent per segment depending on recepient's network provider. A segment is 160 characters. Rating prompts include “Reply 0-5 (5 = best). You can add a comment…”, so they will often run past 160 and be billed as two. Shortening that wording would cut the cost.
  * Follow-ups multiply the cost. The worst case is 4 outbound texts per prompt (the prompt plus 3 follow-ups), plus the parent’s reply. At 40 prompts a day with every follow-up sent, that’s about 160 texts a day. That comes to roughly $60 a month on Twilio and $40 on Telnyx, before two-segment prompts and replies. Real usage should be well below that, because a reply stops the follow-ups.
  * Calls would cost more per attempt. A call to a 1-minute prompt is around $0.014 on Twilio and $0.007 on Telnyx. Both are cheap per call, but a follow-up call every 30 minutes adds up in the same way.
  * Switching providers is mostly one file. Texts only touch messaging.js and the inbound webhook. Calls are different on each platform, so it’s better to choose before building voice.
* if database is linked to the app, how do clients enter their info? through the website? can the two be linked? 
google calendar to schedule appointments?
main question: what happens after a client reaches out?

  * you want to be able to send them a form which they complete and then upload that to the app.

