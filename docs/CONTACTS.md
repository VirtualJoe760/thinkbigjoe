# Contacts — TBJ's own CRM (the `contacts` table)

**Read this when** you touch contact data: the `contacts` table, the Settings "Business details" form,
contact enrichment, the lead engine's scrape, or anything that reads a business owner's name / email /
phone / address.

## What it is — and what it is NOT

`contacts` is **one row per PERSON ThinkBigJoe deals with**. It is TBJ's CRM, the source of truth for
who we're talking to and how to reach them:

- the scraped **business owner** of a prospect site,
- an **enriched decision-maker** we researched,
- an **inbound web-form lead**,
- the **owner once they claim** their site (same person — `lifecycle` advances, the row isn't
  duplicated).

It is **NOT the client's customers.** The people who book a *client's* business, or sit on a client's
newsletter list, are the **client's** CRM, not ours. Those live in:

- `newsletter_contacts` — the client's uploaded / imported newsletter audience (per `site_id`), and
- the **client's own Google Contacts** ("Website Leads" group, written by `src/lib/site-booking.ts`).

Keep that line. If TBJ's `contacts` table ever holds every customer of every client, we've taken on a
privacy and deletion liability that isn't ours to carry. Decided deliberately — don't merge them.

## Shape

`contacts` (pulled into `src/db/schema.ts`; DB is source of truth — change it in SQL, then `db:pull`):

| Column | Notes |
|---|---|
| `site_id` | FK → `forge_sites(id)`, `ON DELETE SET NULL`. A contact can outlive a torn-down site. |
| `role` | `owner` \| `decision_maker` \| `inbound_lead` \| `other`. One **unique** `owner` per site (partial unique index `contacts_site_owner_key`). |
| `lifecycle` | `prospect` → `lead` → `client` → `past_client`. |
| `business_name`, `name`, `email`, `phone`, `address`, `city`, `service_area` | The contact fields. `address` is new — the Apify scrape always returned it, we just weren't storing it. |
| `website_url`, `instagram_url`, `facebook_url`, `linkedin_url` | |
| `source` | `scrape` \| `enrichment` \| `inbound` \| `claim` \| `manual` — where the current data came from. |
| `do_not_contact` | Suppression flag. |
| `email_verified_at`, `enriched_at` | Provenance timestamps. |
| `user_id` | `better_auth.user.id` once the owner claims — links the CRM row to the portal account. |

Indexes: `contacts_site_idx`, `contacts_email_idx` (`lower(email)`), `contacts_user_idx`, and the
partial unique `contacts_site_owner_key`.

## The helper: `src/lib/contacts.ts`

Everything goes through this — don't hand-write `contacts` queries in pages/routes.

- `getOwnerContact(siteId)` / `getOwnerContactForUser(userId)` — read the primary contact.
- `ensureOwnerContact(siteId, userId?)` — **idempotent**. Creates the owner contact from the site's
  scraped fields if missing, and on a claim attaches `user_id` + advances `lifecycle` to `client`.
  Safe to call on every Settings load and every claim.
- `updateOwnerContact(siteId, patch)` — the Settings save. Blanks normalize to `null`.

## Where it surfaces

- **`/portal/settings` → "Business details"** — Business name, Owner name, Email, Phone, Address.
  Prepopulated from the scrape on claim (`ensureOwnerContact`), edited via `saveContactAction`
  (`role='owner'` on a site THIS user claimed — can't be pointed at someone else's row).
- **`scripts/lead-engine.mjs`** — now stores `b.address` on the `forge_sites` insert, so future
  prospects carry an address for the backfill / prepopulation.

## Migration status — READ before "cleaning up" forge_sites

`forge_sites` STILL carries the legacy contact columns: `email`, `phone`, `owner_name`, `city`,
`service_area`, `instagram_url`, `facebook_url`, `linkedin_url`, `contact_notes`, `contact_enriched_at`,
plus the new `address`. **They are still the source of truth for the live senders.**

`forge_sites.email` / `.phone` are read **directly by ~14 files**, including all three outreach
channels — `src/app/api/forge/send-outreach`, `src/lib/voicemail-outreach.ts`, the SMS path — plus
`src/lib/forge-optout.ts`, the newsletter, and the `/command` UI. Those fire ~40+ touches/day.

So the cutover is **staged, not a big-bang rename**:

1. ✅ `contacts` table created + backfilled one `owner` row per site (done).
2. ✅ Settings reads/writes `contacts`; lead engine captures `address`.
3. ⏳ Point the senders + opt-out + enrichment at `contacts` (via the `contacts.ts` helpers), one at a
   time, each verified against live outreach.
4. ⏳ Only once nothing reads them, drop the legacy `forge_sites` contact columns.

Do **not** delete the `forge_sites` columns before step 3 is complete for every reader — grep
`forgeSites.(email|phone|ownerName)` first. `contact_overrides` (a `phone → display_name` patch) also
becomes redundant once `contacts.name` is authoritative in the messaging UI; retire it in step 3.

## Related

- [`SHOWROOM.md`](SHOWROOM.md) — the discovered → preview → claim funnel that creates these rows.
- [`AUTH.md`](AUTH.md) — `better_auth.user`, which `contacts.user_id` links to.
- [`VOICEMAIL.md`](VOICEMAIL.md) / [`SMS.md`](SMS.md) — senders that still read `forge_sites` contact
  columns (the step-3 cutover targets).
