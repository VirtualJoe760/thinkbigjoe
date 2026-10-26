# Contractor tools — website add-ons for Coachella Valley home services

> **Status: PROPOSED (2026-10-26).** Shown on the home page (`src/components/marketing/contractor-tools.tsx`,
> section `#tools`) as things "we build for your business". **None ships as a ready-made product
> yet** — each is a per-client build today. Before promising a delivery date, check this table.

Target buyer: owner-operated GCs, plumbers, HVAC, roofers and remodelers in the Coachella Valley
(see `BUSINESS_PLAN.md`). Every tool has to do one of three things for them: **win the job**,
**cut phone time**, or **get paid faster**. If it doesn't, it isn't on this list.

## On the home page (the six)

| Tool | What the owner gets | What it takes to build | Reuses |
|---|---|---|---|
| **Instant estimate calculator** | Ballpark price on the site → a lead who already knows the range | Per-trade formula (roof sq ft × $/sq, bath count × base, AC tonnage) the owner sets in the portal; form posts a lead | Contact form → `leads` pipeline; portal settings |
| **Job status for customers** (login) | "Scheduled / in progress / done" + photos → fewer "when are you coming?" calls | A `jobs` table per site, a customer-facing magic-link login (no passwords), owner updates status from the portal by phone | better-auth (already in the app), Vercel Blob for photos |
| **Send a photo, get a quote** | Customer attaches photos of the problem → faster quotes, right parts on the truck | Upload field on the site's request form → Blob → shown on the lead in the portal | `src/lib/blob.ts`, newsletter upload route as a pattern |
| **Get paid by text** | Invoice sent to the customer's phone, paid by card | Stripe payment link per invoice + transactional SMS | Stripe (live), `src/lib/sms.ts` — ⚠️ transactional only, see `SMS.md` |
| **Service reminders** | Spring AC tune-up, pre-monsoon roof check, yearly maintenance → steady work in slow months | The client's own customer list + a schedule; email first (SMS needs consent) | Newsletter engine + `newsletter_contacts` (`NEWSLETTER.md`) |
| **Before-and-after gallery** | Owner uploads job photos from their phone, they appear on the site | Gallery section in the forge template + portal upload | Portal editor / Image Studio (`EDITOR.md`) |

## Good next candidates (not on the page)

- **Emergency button** — "No AC / water leak" fast lane that routes straight to the receptionist as urgent.
- **Service-area check** — customer types a ZIP, sees "Yes, we cover Indio" (cuts out-of-area calls).
- **Financing pre-qualification** — "See monthly payments" for $8k+ roofs and remodels (partner integration; compliance review first).
- **Permit + inspection tracker** — for remodelers and GCs; folds into job status.
- **Warranty lookup** — customer enters their address, sees what's covered and until when.

## Order to build (recommendation)

1. **Photo quote requests** — smallest build, every trade benefits, sharpens the receptionist pitch.
2. **Estimate calculator** — the strongest website differentiator for roofers/remodelers.
3. **Job status with login** — biggest "fewer phone calls" win; needs the `jobs` model first.
4. Pay by text → service reminders → gallery.

THE RULE (`AGENTS.md`) applies the day any of these ships as a product: UI surface + MCP tool +
schedule in one PR, and this doc's status line gets updated.
