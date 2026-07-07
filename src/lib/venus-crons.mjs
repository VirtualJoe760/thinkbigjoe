// ---------------------------------------------------------------------------
// Venus cron manifest — the SINGLE SOURCE OF TRUTH for Venus's scheduled work.
//
// Every Venus workflow is declared here: its schedule, the exact prompt Venus
// runs, the MCP tools it calls, and the UI surface it feeds. This file is
// version-controlled so the prompts are diffable and reviewable in PRs.
//
//   • Edit a cron        → change it here, then run `npm run venus:sync`.
//   • Add a Venus feature → add its entry here in the SAME PR as the MCP tool
//                           and the UI surface. Full-stack or it doesn't ship.
//   • See what's running → /command/crons reads this file.
//
// `npm run venus:sync` reconciles the local OpenClaw cron store to match this
// manifest (add / edit by name). OpenClaw only executes — this is the plan.
//
// Plain .mjs (no TS) so both the Next.js app and the sync script import it.
//
// NOT listed here (deterministic launchd crons on Joe's Mac, not OpenClaw agents):
//   • forge-poll   (com.thinkbigjoe.forgepoll)  — builds approved forge_sites.
//   • lead-engine  (com.thinkbigjoe.leadengine) — every 3h, scrapes Apify toward the
//     monthly LEAD GOAL within the APIFY BUDGET (config + progress in the `lead_engine`
//     table, shown on /command/prospects). scripts/lead-engine.mjs. When the Apify
//     credit is spent it no-ops and the agent scout cron below (browser fallback) carries
//     the goal. These are infra, not cognitive work — so they live in launchd, not here.
//   • enrich-engine (com.thinkbigjoe.enrichengine) — every 4h, fills email/socials for
//     no-website leads: Google-searches "<name> <city>" → finds the Facebook page + Yelp,
//     scrapes the FB page for email/Messenger, gap-fills forge_sites. scripts/enrich-engine.mjs.
// ---------------------------------------------------------------------------

export const VENUS_CRONS = [
  {
    name: "TBJ Forge Prospect Scout",
    id: "f35d15ce-4f67-489b-aef3-fe426b3aa007",
    agent: "prospector",
    schedule: "0 4,12,20 * * *",
    stagger: "5m",
    summary: "Find local service businesses with no/bad website for the site-building forge (3×/day, toward the monthly lead goal).",
    tools: ["apify_find_businesses", "apify_find_instagram", "apify_extract_contacts", "add_forge_prospect", "list_forge_queue", "list_forge_blacklist", "log_activity"],
    uiSurface: ["/command/sites", "/command/prospects (Lead engine panel)"],
    eventTypes: ["forge_scout_complete", "forge_prospect_added"],
    prompt: `This is a scouting run (you run 3× a day now). Follow your sourcing loop (AGENTS.md) to find local service businesses that need a website.

THE GOAL: Joe wants ~2,500 fresh leads a MONTH (~85/day) — enough to make 2–5 sales a day by calling. A deterministic "lead engine" scrapes bulk leads via Apify every 3 hours; YOUR job is to ADD to that with the businesses Apify's basic search misses — Instagram-native businesses, businesses needing a judgment call on a weak existing site, and (when the Apify credit is used up) browser-scraped leads. Push hard toward the daily pace every run.

1. DEDUP + BLACKLIST: call list_forge_queue (no filter) AND list_forge_blacklist. Skip any business already queued (by name + city) AND any business on the blacklist — Joe denied those, so never research or re-add them (match by name+city or their website domain). add_forge_prospect also hard-blocks blacklisted businesses, but don't waste a crawl on one.

2. SEARCH — GO WIDE, GO NATIONAL (use Apify, not the browser — it's faster + far cheaper): research **25–40** owner-operated local service businesses ACROSS THE USA this run. Each run pick **4–6 DIFFERENT US metros** and rotate the region every run so coverage spreads nationwide — Sun Belt (Phoenix/Vegas/Tucson) → Texas (Dallas/Houston/San Antonio/Austin) → Southeast (Atlanta/Charlotte/Tampa/Nashville) → Midwest (Chicago/Columbus/KC/Indianapolis) → Northeast (Philly/Boston/Pittsburgh) → Mountain West (Denver/Salt Lake/Boise) → Pacific NW (Portland/Seattle/Spokane) → California (Sacramento/Fresno/San Diego). Widen the TRADES too: HVAC, roofing, electrical, plumbing, landscaping, garage doors, pest control, painting, concrete/masonry, fencing, tree service, pressure washing, pool service, handyman, appliance repair, auto detailing, cleaning services, movers, locksmiths, and similar owner-run trades.
   - For each trade × metro, call **apify_find_businesses(query, location, max)** — it returns businesses with their website (or NONE), phone, rating, reviews, and maps link as clean data. A business with **NO website is an immediate strong lead**; for ones that DO list a site, open it and rate per your rubric.
   - ALSO call **apify_find_instagram("<trade> <city>")** to catch businesses that run off a **business Instagram with no website** — those are prime leads (they invest in their presence but have no site).
   - **FALLBACK:** if an Apify tool returns an error (❌ — e.g. the free credit is used up), don't stop — fall back to your ORIGINAL method: search Google Maps + Google directly in Chrome and rate each site by hand (your AGENTS.md sourcing loop). Apify is the fast/cheap path; the browser is the always-available backup.
   - Use the cities already in list_forge_queue to AVOID saturated metros. Queue ONLY businesses with no website (0) or a weak/dated/broken one (rated ≤ 4).

3. QUEUE — CAPTURE EVERY WAY TO REACH THEM (solve contact at the source): for each qualifying business, before you queue it, pull its contacts. If it has a website, call **apify_extract_contacts(website_url)** — one call returns all emails, phones, and social URLs on the site. If it's IG-native (from apify_find_instagram), use the handle + bio email. Then call add_forge_prospect with:
   - business_name, niche (one line), city, phone, a one-line fit_reason (why the web presence is weak), existing_website_url if any, a guessed brand_color hex.
   - **owner_name** — the owner/decision-maker's name (from the site, Google, or socials).
   - **email** — from apify_extract_contacts, the Google listing, or the IG bio.
   - **instagram_url** and **facebook_url** (local trades live on these), plus linkedin_url if present.
   - From apify_find_businesses: google_rating, review_count, google_maps_url.
   A lead with a phone + email + Instagram is worth far more than a name alone — capture every channel. Only record contacts that are real (not stock/placeholder).

4. LOG: finish with log_activity, event_type "forge_scout_complete", summary like "Queued N · Queue total: Z". marketing-manager reads this for the digest — you don't message Joe directly.`,
  },

  {
    name: "TBJ Forge Contact Enrichment",
    id: "eb7d66fe-8347-452e-bde7-53df7455f886",
    agent: "prospector",
    schedule: "0 6,13,20 * * *",
    stagger: "5m",
    summary: "Browser-research contact info AND call-prep (reviews, social stats, talking points) for forge leads — free, no paid scraping.",
    tools: ["list_forge_needs_contact", "list_forge_needs_callprep", "enrich_forge_contact", "save_forge_callprep", "log_activity"],
    uiSurface: ["/command/prospects (contact cards + Call-prep card)"],
    eventTypes: ["forge_contact_enriched", "forge_callprep"],
    prompt: `This is your enrichment run — the FREE, browser-based way to fill lead data (do NOT use the paid Apify tools here; those cost money and the paid engines handle bulk finding). You do two jobs each run: (A) find missing contact info, (B) build call-prep. You drive Chrome — this is exactly the research you're best at.

=== A) CONTACT ENRICHMENT ===
1. PULL: call list_forge_needs_contact — leads missing an email or owner (BUILT ones first).
2. HUNT by hand, be exhaustive: Google Business Profile + "[biz] owner/email"; Facebook About + Messenger; LinkedIn; Nextdoor; directories — Yelp, **BBB** (names the owner/principal), Angi, Thumbtack, Yellow Pages, Manta, local Chamber; Secretary of State registry; WHOIS. Capture the OWNER's name, a real EMAIL, and social URLs. NEVER invent contact info — only record what you verify.
3. SAVE: enrich_forge_contact(site_id, owner_name, email, phone, instagram_url, facebook_url, linkedin_url, notes) — only fields you found; it gap-fills.

=== B) CALL-PREP (what Joe says on the phone) ===
4. PULL: call list_forge_needs_callprep — leads with no talking points yet (most-reviewed first).
5. For each, open in Chrome and gather:
   - **Google Maps listing** → the exact star rating + review count, and copy **2–3 real review quotes** (reviewer name + the text — pick positive, specific ones).
   - **Facebook / Instagram** → their **follower counts**.
6. SAVE: save_forge_callprep(site_id, google_rating, review_count, review_quotes:[{stars,name,text}], social_stats:{facebook:{followers},instagram:{followers}}, call_prep). Write **call_prep** as a tight script Joe can read off:
   - Open warm — praise a real strength (their rating, years in business) and reference a specific review.
   - The gap — no website, so people who search them can't find/book them; those leads go to a competitor who has a site.
   - The pitch — our plan turns their reputation into booked jobs: a pro site + click-to-call + online booking + a dashboard that captures & organizes every lead (more sales, less chaos).
   - Close — offer to text them the live site we already built.

7. LOG: finish with log_activity, event_type "forge_contact_enriched", summary like "Enriched N contacts · Call-prepped M leads". marketing-manager reads this for the digest — you don't message Joe directly.`,
  },

  {
    name: "TBJ Forge Outreach",
    id: "d9818115-bb73-4d74-8f65-46f8b5ebcc36",
    agent: "outreach",
    schedule: "0 16 * * *",
    stagger: "5m",
    summary: "First-touch preview-ready prospects — invite them to CLAIM their free preview (claiming builds the site); Joe calls second.",
    tools: ["list_forge_preview_outreach", "save_forge_outreach_draft", "mark_forge_outreach_sent", "log_activity"],
    uiSurface: ["/command/prospects (preview first-touch → Joe calls second)"],
    eventTypes: ["forge_outreach_drafted", "forge_outreach_sent"],
    prompt: `This is the forge FIRST-TOUCH run (SHOWROOM / sell-first). Each prospect already has a free personalized PREVIEW of a new website waiting. **Your job: invite them to CLAIM it — claiming is what triggers us to build & launch the real site.** You do the first touch; Joe calls them as the second touch.

1. PULL: call list_forge_preview_outreach (stage "none") — each preview-ready prospect with its PREVIEW URL (/s/<slug>), CLAIM CODE, reserved-days, and EVERY channel we have (email, phone, Instagram, Facebook, LinkedIn).

2. FIRST-TOUCH each on the BEST channel available:
   - Has an EMAIL → save_forge_outreach_draft(site_id, "email", subject, body): a short warm note FROM JOE — "I built you a preview of a new site for <business>: <preview link>. If you like it, claim it with code <code> and we'll build & launch the full thing (free to look, reserved for you for a couple weeks)." 3–5 sentences, reference a real detail (their reviews, a service). Joe reviews + sends.
   - No email but a SOCIAL (Instagram/Facebook/LinkedIn) → save_forge_outreach_draft(site_id, channel, "", body): a short friendly DM with the preview link + claim invite. Joe reviews it, then YOU open their profile and send the DM, and afterward call mark_forge_outreach_sent(site_id, channel).
   - No email or social → leave it; Joe calls the phone from the contact card.
   Genuine and non-pushy, matched to the trade. ALWAYS include the preview link + claim code. NEVER invent contact info.

3. LOG: finish with log_activity, event_type "forge_outreach_drafted", summary like "First-touched N previews · M email drafts · K social DMs sent · P phone-only left for Joe". marketing-manager reads this for the digest — you don't message Joe directly.`,
  },

  {
    name: "TBJ Forge Follow-up",
    id: "97e8158f-5445-48a1-b276-72e777893ac9",
    agent: "outreach",
    schedule: "0 17 * * *",
    stagger: "5m",
    summary: "Draft follow-up emails for built sites the owner hasn't claimed or replied to.",
    tools: ["list_forge_followup_due", "save_forge_outreach_draft", "log_activity"],
    uiSurface: ["/command/prospects (Built — follow-up draft → Approve & send)"],
    eventTypes: ["forge_outreach_drafted"],
    prompt: `This is the forge follow-up run. Owners who got a first touch but haven't claimed their preview (or site) or replied are due for a nudge.

1. PULL: call list_forge_followup_due — unclaimed prospects >3 days since their last email, under 3 emails total. Each shows the business, its link (a PREVIEW /s/<slug> if not yet built, else the live site), claim code + reserved-days, which TOUCH is next, and the prior subject.

2. DRAFT one follow-up per prospect with a NEW angle — never repeat the prior email:
   - TOUCH 2: a short, warm nudge with a fresh benefit ("your preview's still reserved — takes 2 minutes to claim and we build the real thing", a specific thing the site does better). Re-share the link.
   - TOUCH 3: a brief, friendly "last note" break-up — no guilt, leave the door open, one line that they can still claim it or book a call anytime.
   Include the link + claim code. Keep it 2–4 sentences, matched to the trade. Call save_forge_outreach_draft(site_id, subject, body). DRAFT ONLY — Joe reviews and sends. NEVER send yourself, and NEVER go past touch 3.

3. Finish with log_activity, event_type "forge_outreach_drafted", summary like "Drafted N follow-ups (touches 2–3)". marketing-manager reads this for the digest — you don't message Joe directly.`,
  },
];

export default VENUS_CRONS;
