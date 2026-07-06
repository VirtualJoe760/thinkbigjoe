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
// ---------------------------------------------------------------------------

export const VENUS_CRONS = [
  {
    name: "TBJ Forge Prospect Scout",
    id: "f35d15ce-4f67-489b-aef3-fe426b3aa007",
    agent: "prospector",
    schedule: "0 4 * * *",
    stagger: "5m",
    summary: "Find local service businesses with no/bad website for the site-building forge.",
    tools: ["add_forge_prospect", "list_forge_queue", "list_forge_blacklist", "log_activity"],
    uiSurface: ["/command/sites"],
    eventTypes: ["forge_scout_complete", "forge_prospect_added"],
    prompt: `This is your daily scouting run. Follow your sourcing loop (AGENTS.md) to find local service businesses that need a website.

1. DEDUP + BLACKLIST: call list_forge_queue (no filter) AND list_forge_blacklist. Skip any business already queued (by name + city) AND any business on the blacklist — Joe denied those, so never research or re-add them (match by name+city or their website domain). add_forge_prospect also hard-blocks blacklisted businesses, but don't waste a crawl on one.

2. SEARCH — GO WIDE, GO NATIONAL: research **25–40** owner-operated local service businesses ACROSS THE USA this run (cast a wide net — volume matters, as long as each one genuinely has a weak/no web presence). Each run pick **4–6 DIFFERENT US metros** and rotate the region every run so coverage spreads nationwide — Sun Belt (Phoenix/Vegas/Tucson) → Texas (Dallas/Houston/San Antonio/Austin) → Southeast (Atlanta/Charlotte/Tampa/Nashville) → Midwest (Chicago/Columbus/KC/Indianapolis) → Northeast (Philly/Boston/Pittsburgh) → Mountain West (Denver/Salt Lake/Boise) → Pacific NW (Portland/Seattle/Spokane) → California (Sacramento/Fresno/San Diego). Use the cities already in list_forge_queue to AVOID saturated metros and deliberately pick fresh ones. Widen the TRADES too: HVAC, roofing, electrical, plumbing, landscaping, garage doors, pest control, painting, concrete/masonry, fencing, tree service, pressure washing, pool service, handyman, appliance repair, auto detailing, cleaning services, movers, locksmiths, and similar owner-run trades. Use Google Maps + Google Search; open and rate each site per your rubric. Queue ONLY businesses with no website (0) or a weak/dated/broken one (rated ≤ 4).

3. QUEUE — CAPTURE EVERY WAY TO REACH THEM (solve contact at the source): for each qualifying business, before you queue it, spend a moment to find how to reach the OWNER — this is as important as finding the business. Then call add_forge_prospect with:
   - business_name, niche (one line), city, phone, a one-line fit_reason (why the web presence is weak), existing_website_url if any, a guessed brand_color hex.
   - **owner_name** — the owner/decision-maker's name (from their site's about page, Google, or socials).
   - **email** — hunt for one on their website contact/about page, Google listing, or socials.
   - **instagram_url** and **facebook_url** — local trades live on these; usually the fastest way to message them. Plus linkedin_url if they have one.
   - From the Google Maps listing: google_rating, review_count, google_maps_url.
   A lead with a phone + email + Instagram is worth far more than a name alone — the more channels you capture NOW, the sooner communication can first-touch them. Don't invent anything; only record what you verify on a real page.

4. LOG: finish with log_activity, event_type "forge_scout_complete", summary like "Queued N · Queue total: Z". marketing-manager reads this for the digest — you don't message Joe directly.`,
  },

  {
    name: "TBJ Forge Contact Enrichment",
    id: "eb7d66fe-8347-452e-bde7-53df7455f886",
    agent: "prospector",
    schedule: "0 5 * * *",
    stagger: "5m",
    summary: "Find owner names, emails, and socials for forge sites missing a way to reach them.",
    tools: ["list_forge_needs_contact", "enrich_forge_contact", "log_activity"],
    uiSurface: ["/command/prospects (contact cards)"],
    eventTypes: ["forge_contact_enriched"],
    prompt: `This is your contact-enrichment run. Lots of forge sites have a phone but no EMAIL or OWNER name — Joe needs a real way to reach these owners (to call and email them).

1. PULL: call list_forge_needs_contact — sites missing an email or owner (BUILT ones first, they're ready for outreach/calls).

2. HUNT — CHECK EVERY SOURCE (be exhaustive; don't stop at the first miss). Work down this list until you've got an email + owner + at least one social:
   - **Their website**: contact page, about/"meet the team" page, the FOOTER (emails often live there), booking page, and the privacy/terms page (frequently lists a real email). Check any mailto: links.
   - **Google**: their Google Business Profile / Maps listing (phone, site, sometimes email/messaging), then plain Google searches — "[business] owner", "[business] email", "[owner name] [city]".
   - **Socials**: Instagram (bio + the "Email" contact button), Facebook (About → contact info + page email + Messenger), LinkedIn (company page AND the owner's profile), plus Nextdoor, YouTube, TikTok, X if present.
   - **Directories & review sites**: Yelp, the **BBB** (Better Business Bureau — usually names the owner/principal + contact), Angi, HomeAdvisor, Thumbtack, Houzz, Yellow Pages, Manta, Bizapedia, and the local Chamber of Commerce.
   - **Registries**: the state Secretary of State business registry (owner / registered agent name), and county/city business licenses.
   - **Domain**: a WHOIS lookup on their website domain (registrant name/email, if not privacy-protected).
   Capture: the OWNER / decision-maker's name, a real EMAIL, social profile URLs (Instagram/Facebook/LinkedIn), and a short note on the BEST way to reach them (which number, which channel, gatekeeper, hours). NEVER invent contact info — only record what you actually verify on a real page.

3. SAVE: call enrich_forge_contact(site_id, owner_name, email, phone, instagram_url, facebook_url, linkedin_url, notes) with ONLY the fields you found. It gap-fills, so it won't overwrite what's already there.

4. LOG: finish with log_activity, event_type "forge_contact_enriched", summary like "Enriched N sites · M new emails · K owner names". marketing-manager reads this for the digest — you don't message Joe directly.`,
  },

  {
    name: "TBJ Forge Outreach",
    id: "d9818115-bb73-4d74-8f65-46f8b5ebcc36",
    agent: "outreach",
    schedule: "0 16 * * *",
    stagger: "5m",
    summary: "First-touch newly-built sites on the best channel (email or social DM); Joe calls second.",
    tools: ["list_forge_outreach_queue", "save_forge_outreach_draft", "mark_forge_outreach_sent", "log_activity"],
    uiSurface: ["/command/prospects (Built — first-touch → Joe calls second)"],
    eventTypes: ["forge_outreach_drafted", "forge_outreach_sent"],
    prompt: `This is the forge FIRST-TOUCH run. Sites the forge BUILT are waiting to hear from us. **You do the first touch; Joe calls them as the second touch.**

1. PULL: call list_forge_outreach_queue (stage "none") — each built, unclaimed site with its live-site URL, claim code, and EVERY channel we have (email, phone, Instagram, Facebook, LinkedIn).

2. FIRST-TOUCH each site on the BEST channel available:
   - Has an EMAIL → save_forge_outreach_draft(site_id, "email", subject, body): a short warm note FROM JOE — their new site is LIVE (link auto-appended), the CLAIM CODE to sign in and claim it (auto-appended, reference it naturally), and an invite to book a quick call (button auto-appended). 3–5 sentences. Joe reviews + sends.
   - No email but a SOCIAL (Instagram/Facebook/LinkedIn) → save_forge_outreach_draft(site_id, channel, "", body): a short friendly DM — site's live, here's how to claim it, happy to chat. Joe reviews it, then YOU open their profile and send the DM, and afterward call mark_forge_outreach_sent(site_id, channel).
   - No email or social → leave it; Joe calls the phone from the contact card.
   Genuine and non-pushy, matched to the trade. Personalize on real signal — NEVER invent contact info.

3. LOG: finish with log_activity, event_type "forge_outreach_drafted", summary like "First-touched N sites · M email drafts · K social DMs sent · P phone-only left for Joe". marketing-manager reads this for the digest — you don't message Joe directly.`,
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
    prompt: `This is the forge follow-up run. Owners who got an initial email but haven't claimed their site or replied are due for a nudge.

1. PULL: call list_forge_followup_due — built, unclaimed sites >3 days since their last email, under 3 emails total. Each shows the business, live-site URL, claim code, which TOUCH is next, and the prior subject.

2. DRAFT one follow-up per site with a NEW angle — never repeat the prior email:
   - TOUCH 2: a short, warm nudge that adds a fresh benefit ("it's ready whenever you are — takes 2 minutes to claim", a specific thing the new site does better). Reference that their site is still live.
   - TOUCH 3: a brief, friendly "last note" break-up — no guilt, leave the door open, one line that they can still claim it or book a call anytime.
   The live-site link, claim code, and book-a-call button are appended automatically. Keep it 2–4 sentences, matched to the trade. Call save_forge_outreach_draft(site_id, subject, body). DRAFT ONLY — Joe reviews and sends. NEVER send yourself, and NEVER go past touch 3.

3. Finish with log_activity, event_type "forge_outreach_drafted", summary like "Drafted N follow-ups (touches 2–3)". marketing-manager reads this for the digest — you don't message Joe directly.`,
  },
];

export default VENUS_CRONS;
