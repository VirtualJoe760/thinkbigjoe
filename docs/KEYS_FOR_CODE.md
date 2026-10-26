# Keys for Code — referral program

> **Status: DRAFT (2026-10-26).** Page at `/keys-for-code` (`src/app/(frontend)/keys-for-code/`)
> is designed and **noindex + not in the nav**. The intake form is a **preview** — submissions
> are not saved or sent anywhere. Two gates before launch, below.

## The program

Home service pros in the Coachella Valley (GCs, plumbers, HVAC, roofers, remodelers, …) refer
real estate clients to **Joe Sardella, REALTOR®** (DRE# 02106916, eXp Realty of Southern
California). When a referred client's purchase or sale **closes escrow** with Joe as agent, the
referrer earns **one free full-stack website**: customer logins + job tracking, online payments,
estimate calculator, AI remodel previews from the builder's materials.

Flow: referrer submits the form → TBJ saves it and pushes the client into jpsrealtor.com's CRM →
referrer does a **warm hand-off** (group text: referrer + client + Joe at (760) 333-3676) → Joe
works the deal → escrow closes → credit issued → forge builds the site.

## ⚠️ Gate 1 — compliance sign-off (before ANY public launch)

Giving a "thing of value" (a website worth thousands) **in exchange for referring someone to a
real estate agent**, conditioned on closing, can fall under:

- **RESPA §8 (12 U.S.C. §2607)** — bars giving anything of value for referrals of settlement
  service business on federally related mortgage loans. A real estate agent's services are
  settlement services; the referrer doesn't need to be in real estate for this to apply.
- **California DRE rules** on compensating unlicensed persons for referrals (B&P Code §10137 and
  related guidance).
- **eXp / brokerage policy** — referral programs and advertising usually need broker approval.

Get Joe's **broker (eXp compliance)** and/or a **California real estate attorney** to approve the
structure *before* launch. Possible restructurings they may suggest: make the website a general
promotion not tied to referrals, use a co-marketing agreement at fair market value, or limit the
program to cash transactions. **This doc is not legal advice.**

Ad requirements already on the page: licensee name, DRE#, broker name, Equal Housing
Opportunity. Keep that disclosure block if the copy changes.

## Gate 2 — wire the intake (THE RULE: UI + MCP tool + schedule)

| Layer | Plan |
|---|---|
| **DB** | `realty_referrals` table (referrer name/business/trade/phone/email, client name/phone/email/area, intent, timeframe, notes, consent flags + timestamp/IP, `status` = submitted → pushed → handed_off → in_escrow → closed → credit_issued / lost, `jps_contact_id`, `site_id` once built). |
| **Intake API** | Server action on `/keys-for-code`: validate, Turnstile, rate-limit, insert, Telegram Joe (alerts bot), confirmation email to referrer. |
| **jpsrealtor push** | jpsrealtor (`~/code/chatrealty/jpsrealtor`) has a token-protected Skill API (`withSkill`, `contacts:write` scope). The existing `/api/skill/contacts/from-signup` **also creates an end-user account** — wrong for a referred client. Add a dedicated **`POST /api/skill/contacts/referral`** there: upsert a Contact with `source: 'referral'`, tags `["Keys for Code", trade]`, a note naming the referrer, mirrored to Joe's CRM. Mint a Skill token for Joe's tenant; store as `JPSREALTOR_SKILL_TOKEN` in this repo's env. |
| **UI** | `/command/referrals` — referral list with status buttons (handed off / in escrow / closed / lost); "closed" issues the credit. Referrer sees their referral + credit status in `/portal`. |
| **MCP tool** | `list_referrals` + `update_referral_status` (audited) so Venus can report on the program. |
| **Schedule** | A retry poller for referrals whose jpsrealtor push failed (`status='submitted'` older than 5 min), plus a weekly digest line in Venus's debrief. |

## Open questions for Joe

- Is hosting included after the free build, or billed? (The FAQ currently says hosting/ongoing services are separate and optional.)
- One website per referrer, or one per closed deal (so two closings = two sites / upgrades)?
- Is (760) 333-3676 the number for hand-off group texts?
