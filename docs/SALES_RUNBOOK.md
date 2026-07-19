# Sales Runbook — from cold number to live customer

> **Status**: ACTIVE · **Written**: 2026-07-19 · **Owner**: Joseph Sardella
> The operational companion to [`BUSINESS_PLAN.md`](./BUSINESS_PLAN.md) (strategy) and
> [`ONBOARDING_READINESS.md`](./ONBOARDING_READINESS.md) (what's actually built).
> This is what you say and do. Everything here is meant to be used verbatim or lightly edited.

---

## ⚠️ Blocker: the demo line doesn't demo the product

The entire sales motion rests on *"call this number and hear it yourself."* Today that number is
**480-764-2121 — Ivy, ThinkBigJoe's own claim concierge.** A plumber who calls it gets an agent
trying to walk them through claiming a website. That is not a receptionist demo; it's a different
product's sales pitch.

**Before any outreach goes out, provision a demo agent** configured as a fictional plumbing company's
receptionist on its own number. This is the first real use of the parameterized provisioning work in
[`AGENT_PLATFORM.md`](./AGENT_PLATFORM.md) — build it for the demo, then reuse it for customer #1.

Until that exists, the close is *"let me get you on a quick call and I'll show you"* — weaker, but honest.

---

## The offer — settled wording

> **We answer every call your business misses — 24/7 — qualify the caller, and text you the
> details within seconds.**

**Do not promise job booking yet.** Per the audit, `book_appointment` has no per-customer code path.
Message-taking is the entire tier-1 promise until that ships. It's fully honest and it sidesteps the
calendar problem completely.

**Price:** $250 setup + $497/month. Month-to-month, cancel anytime.
**Activation:** 10 business days from payment. Sell a date, not a same-day install.

---

## 1. Voicemail drop — ~30 seconds

> "Hey, this is Joe with ThinkBigJoe. I called your line Sunday morning around eight and it rang
> out — no complaint, I do that on purpose. I run a service that picks up the calls you miss after
> hours, finds out what the job is, and texts you the details before you're even out of bed. If you
> want to hear what it sounds like, call **[demo number]** and talk to it yourself. That's
> **[demo number]**. Either way, no hard feelings. Talk soon."

**Rules:** name the *actual day and time* you called and what happened. Never say "I noticed you
might be missing calls" — the specificity is the entire product. Never leave a price.

## 2. Follow-up text — send 15 minutes after the drop

> Joe from ThinkBigJoe — just left you a voicemail. I called your line Sun 8:10am and it rang out.
> We pick up those calls 24/7 and text you the details. Hear it yourself: [demo number].
> Reply STOP to opt out.

**Rules:** one text, one follow-up three days later, then stop. STOP must be honored immediately —
this is post-engagement messaging and the opt-out is non-negotiable. See [`SMS.md`](./SMS.md).

## 3. Follow-up text #2 — three days later, then done

> Joe again — last note from me. That after-hours call I mentioned would've been a job for whoever
> picked up. Demo's at [demo number] if you're curious. Otherwise I'll leave you to it.
> Reply STOP to opt out.

---

## 4. The callback — discovery

They're calling *you*, so don't pitch. Ask.

1. "What happens right now when somebody calls you at eight at night?"
2. "Roughly how many of those do you think you're missing a week?"
3. "Are you using an answering service? What are you paying?"
4. "What's an average job worth to you?"
5. "When a call does come in after hours — do you want a text, an email, or both?"

**The number that closes the deal is theirs, not yours.** Average ticket × missed calls per week is
the whole pitch. If a $400 average and three missed calls a week is right, that's $4,800 a month
walking out the door against a $497 bill. Let them do that math out loud.

---

## 5. Objections

| They say | You say |
|---|---|
| **"I have an answering service."** | "What are you paying them? And do they actually qualify the job, or just take a name and number?" Most take a message. You qualify, and you cost less. |
| **"I just call people back."** | "How long does that usually take? Because most people hire whoever picks up first — by the time you're calling back at seven the next morning, they've already booked someone." |
| **"AI sounds robotic."** | "You just talked to it. What'd you think?" (This is why the demo comes before the pitch.) |
| **"Too expensive."** | "What's your average job? …So one job a month covers it. If it doesn't catch you one job, cancel — it's month to month." |
| **"I don't miss calls."** | "I called Sunday at 8:10 and it rang out. That's why you're on my list." |
| **"Let me think about it."** | "Sure. Can I ask what you'd be thinking about — whether it works, or whether it's worth it?" Then answer the real objection. |
| **"Can it book jobs on my calendar?"** | "Not yet — right now it qualifies the caller and texts you everything so you can book it. Calendar booking is coming." **Do not promise a date.** |

---

## 6. The close

> "Here's how it works. It's $250 to set up and $497 a month, month to month — cancel any time. I
> need about twenty minutes with you to get your business details, then you're live in ten business
> days. Want me to send you the link?"

Then send the payment link and **book the intake call before you hang up.** A sale without a booked
intake stalls.

---

## 7. What you need from the customer — the intake

Collect all of this on one call. Missing any item stalls provisioning.

**Business**
- Legal + trading name, and how they answer the phone today ("Thanks for calling ___")
- Services offered, and what they *don't* do
- Service area
- Business hours — and specifically **when they want the AI to pick up**: after hours only, or overflow too
- Timezone *(currently defaults to Eastern for everyone — must be set explicitly)*

**Call handling**
- What counts as an emergency, and what should happen when one comes in
- **Escalation phone number** — where urgent calls get transferred, in E.164 format
- Where to send the message: text, email, or both — and to which number/address
- Anything the AI must never say or promise (pricing, timelines, warranty)
- 3–5 common questions callers ask, with the answers

**Technical**
- The business phone number to forward *from*
- Their carrier or phone system (see §8)
- Who controls the phone account — get that person on the forwarding call

---

## 8. Phone forwarding — the step that will go wrong

The customer must forward their line to the number we provision. **This is the moment where you can
break their business phone, so do it live on a call with them, never over email.**

Most US mobile carriers support conditional forwarding via GSM codes dialed from their phone:

| Goal | Code | Turn off |
|---|---|---|
| Forward when no answer | `**61*[number]#` | `##61#` |
| Forward when busy | `**67*[number]#` | `##67#` |
| Forward when unreachable | `**62*[number]#` | `##62#` |
| Forward all calls | `**21*[number]#` | `##21#` |

**Codes vary by carrier — confirm with theirs before dialing.** Landlines and VoIP systems
(RingCentral, Grasshopper, Ooma, Google Voice, a desk PBX) are configured in an admin panel instead;
if they're on one of those, get access or get their IT person on the call.

**Recommended default: conditional forwarding on no-answer, 20–25 seconds of ring.** Their phone
rings first. They keep every call they can actually take. We only get the ones they'd have lost.

### Give them the kill switch, out loud

> "If anything ever seems off, dial `##61#` on your phone and every call comes straight back to you
> — instantly, without me. You're never stuck waiting on me to fix something."

Say this on the forwarding call and put it in the welcome email. It is both true and the single most
reassuring thing you can tell someone handing over their main line — and per the audit, the system
has no automatic fallback yet, so **the customer holding the kill switch is the fallback.**

---

## 9. Onboarding — payment to live

| Day | What happens | Owner |
|---|---|---|
| **0** | Payment clears. Send welcome email + book the intake call. | Joe |
| **0–1** | Intake call, ~20 min. Fill §7 completely. | Joe + customer |
| **1–3** | Build their prompt, provision agent + number, record IDs in the DB. | Joe |
| **3–4** | **Test it yourself — 10 calls minimum.** Emergency, after-hours quote, wrong number, angry customer, someone asking a price, a caller who won't give a name. Fix what breaks. | Joe |
| **5** | Customer test call. They call it and approve, or send changes. | Customer |
| **6** | Changes applied, retested. | Joe |
| **7** | **Forwarding call.** Set it up live together. Test immediately — you call their line and let it ring through. Teach the kill switch. | Joe + customer |
| **7–10** | Watch closely. Listen to every call. Adjust the prompt. | Joe |
| **10** | Live confirmation + first summary of what it caught. | Joe |

**Do not skip day 3–4.** The first customer's calls are real people with real plumbing emergencies.
The prompt will be wrong in ways you can only find by calling it.

---

## 10. Support model

Committing to this in writing, because a solo operator with no stated hours ends up on call 24/7 by
default.

- **Channel:** text or email to Joe. No phone support line.
- **Hours:** 8am–6pm, Mon–Sat. Next business day worst case.
- **Emergency** — defined as *their line isn't working*: immediate, and the first instruction is
  always the kill switch (`##61#`) so they're never blocked waiting on us.
- **Changes to their agent's prompt/answers:** within 2 business days, unlimited.
- **No uptime SLA is offered.** Do not promise one — per the audit there's no monitoring, no
  alerting, and no automatic fallback. Offering an SLA we can't measure is worse than offering none.

---

## 11. Before the first outreach goes out

- [ ] Demo agent provisioned as a plumbing receptionist on its own number *(§ blocker above)*
- [ ] `$497` plan + `$250` setup exist as live Stripe prices, and the `website-first-month-99`
      coupon no longer attaches to them
- [ ] A new customer can actually reach a payment page *(audit: no path exists today)*
- [ ] `inbox-poll` plist fixed — 10 days of dead bounce detection
- [ ] Stripe webhook returns 500 on error instead of swallowing it
- [ ] Welcome email + intake form written
- [ ] Terms of service and cancellation policy published

**Still open, needs a decision:** runway (how many weeks without revenue is survivable), and a
telecom attorney's read on automated call-testing before it's automated. Manual dialing until then.
