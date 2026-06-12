/**
 * Industry landing-page content registry — one entry per targeted vertical
 * (LinkedIn outreach + paid ads land here). Each page funnels into the gated
 * intake → booking flow with the industry prefilled.
 *
 * Lineup is DEMAND-DRIVEN, from verified 2025–2026 research (RSM middle-market
 * survey n=966, GTIA SMB survey n=720, McKinsey State of AI, NVIDIA State of
 * AI, Gartner — see memory: client-acquisition-research):
 *   1. financial-services — strongest adoption + ROI evidence (insurance >90% AI use)
 *   2. manufacturing — #2 SMB vertical "operational with AI" (44%); SCM-agentic
 *      spend forecast $2B → $53B by 2030 (Gartner)
 *   3. ecommerce  — 47% enterprise agentic adoption, top-tier ROI, 36% SMB
 *   4. msps       — #1 SMB vertical (47%); service desk is the #1 agentic use
 *      case; channel play (51% of SMBs buy through MSPs)
 *   5. law-firms  — professional-services contrarian: adoption lags (23%)
 *      precisely because firms lack in-house AI skills — the gap we fill
 * Healthcare deliberately excluded for ads (lowest SMB adoption at 19%,
 * compliance-heavy, longest cycle). Add a vertical = add an entry here.
 */

export interface Industry {
  slug: string;
  name: string;
  /** Short label used in page copy, e.g. "law firms" */
  short: string;
  headline: string;
  subhead: string;
  painPoints: Array<{ title: string; body: string }>;
  useCases: Array<{ title: string; body: string }>;
  ctaHeading: string;
  ctaBody: string;
}

export const INDUSTRIES: Industry[] = [
  {
    slug: "financial-services",
    name: "Financial Services & Insurance",
    short: "financial-services firms",
    headline: "Paperwork is eating your margins. Agents fix that.",
    subhead:
      "Custom AI for lenders, insurance agencies, and advisory firms — application intake, claims triage, and document processing automated under your compliance rules.",
    painPoints: [
      {
        title: "Every application is a paper chase",
        body: "Loan files, claims, onboarding packets — your team spends hours collecting, checking, and re-keying documents that software should be reading.",
      },
      {
        title: "Response time loses the deal",
        body: "Quotes and approvals that take days walk out the door to whoever answers first. Speed is the product now.",
      },
      {
        title: "Compliance rules out consumer AI tools",
        body: "Client financials can't go through a public chatbot. You need automation that runs under your control, with audit trails built in.",
      },
    ],
    useCases: [
      {
        title: "Application & claims intake agents",
        body: "Documents collected, classified, extracted, and triaged automatically — complete files reach your underwriters and adjusters, not inboxes.",
      },
      {
        title: "Document processing & review",
        body: "Statements, policies, and contracts read by AI that flags what matters — exceptions, missing items, and risk — with citations to the page.",
      },
      {
        title: "Compliance-aware client communications",
        body: "Status updates, renewal outreach, and FAQ handling in your approved language, logged for review, escalated to humans when it counts.",
      },
      {
        title: "Core-system integrations",
        body: "MCP connectors that let agents work inside your CRM, AMS, or LOS — automation in the systems of record, not around them.",
      },
    ],
    ctaHeading: "Map the automations your book of business is begging for",
    ctaBody:
      "Tell us about your firm and book a free 30-minute strategy call — we'll identify the highest-ROI workflow to automate first, no pitch.",
  },
  {
    slug: "manufacturing",
    name: "Manufacturing & Logistics",
    short: "manufacturers",
    headline: "Your ops run on tribal knowledge. Make it run on agents.",
    subhead:
      "Custom AI for manufacturers, distributors, and logistics operators — quote-to-order intake, supplier comms, and inventory workflows automated into your ERP.",
    painPoints: [
      {
        title: "Quotes and orders crawl through inboxes",
        body: "RFQs, POs, and order changes arrive as emails and PDFs that someone re-keys into the ERP — slow, error-prone, and unscalable.",
      },
      {
        title: "Supplier and customer comms never stop",
        body: "Where's my order? When does the shipment land? Your best people spend their day answering questions your systems already know.",
      },
      {
        title: "The labor you need doesn't exist",
        body: "Skilled ops and back-office staff are hard to hire and harder to keep. The work keeps growing anyway.",
      },
    ],
    useCases: [
      {
        title: "Quote & order-intake automation",
        body: "RFQs and POs read, validated, priced against your rules, and entered into the ERP — humans approve, not transcribe.",
      },
      {
        title: "Supplier & customer comms agents",
        body: "Order status, shipment tracking, and routine supplier follow-ups answered instantly, escalated when something's actually wrong.",
      },
      {
        title: "Inventory & exception monitoring",
        body: "Agents that watch stock levels, lead times, and late shipments — surfacing exceptions before they become line-down problems.",
      },
      {
        title: "ERP / WMS integrations",
        body: "MCP connectors for your ERP, WMS, and EDI flows — agentic automation wired into the systems that already run the floor.",
      },
    ],
    ctaHeading: "Find the bottleneck worth automating first",
    ctaBody:
      "Tell us about your operation and book a free 30-minute strategy call — we'll map where automation pays back fastest.",
  },
  {
    slug: "ecommerce",
    name: "E-commerce & Retail",
    short: "e-commerce brands",
    headline: "Scale support and ops without scaling payroll.",
    subhead:
      "Custom AI agents for online brands and retailers — customer service, catalog operations, and order workflows automated end to end.",
    painPoints: [
      {
        title: "Support tickets scale with sales",
        body: "Every growth spike buries your team in WISMO tickets, returns, and sizing questions — hiring can't keep up with Q4.",
      },
      {
        title: "Catalog work never ends",
        body: "Product descriptions, variants, translations, and channel listings consume hours that should go to growth.",
      },
      {
        title: "Generic chatbots hurt your brand",
        body: "Canned widget answers frustrate customers. You need agents that know your products, policies, and tone.",
      },
    ],
    useCases: [
      {
        title: "AI customer-service agents",
        body: "Order status, returns, exchanges, and product questions resolved instantly — in your brand voice, with access to real order data.",
      },
      {
        title: "Catalog & content automation",
        body: "Product copy, SEO descriptions, and channel listings generated and synced across your storefronts.",
      },
      {
        title: "Order & inventory workflows",
        body: "Agents that monitor stock, flag anomalies, handle routine supplier comms, and keep ops humming.",
      },
      {
        title: "Storefront integrations",
        body: "MCP connectors for Shopify, your 3PL, and your help desk — automation wired into the systems that run your store.",
      },
    ],
    ctaHeading: "Automate the work between orders",
    ctaBody:
      "Tell us about your store and book a free 30-minute strategy call — we'll map where automation pays for itself fastest.",
  },
  {
    slug: "msps",
    name: "IT Services & MSPs",
    short: "MSPs",
    headline: "Your techs close tickets. Agents should close most of them first.",
    subhead:
      "Custom AI for MSPs and IT-services firms — service-desk agents, ticket triage, and white-label AI offerings your clients are already asking for.",
    painPoints: [
      {
        title: "Tier-1 burns your best margins",
        body: "Password resets, status checks, and known-issue tickets eat tech hours you could bill at project rates.",
      },
      {
        title: "Clients are asking you for AI",
        body: "Your SMB clients want AI automation and assume you provide it. Every month without an offering is revenue handed to someone else.",
      },
      {
        title: "Documentation debt slows every ticket",
        body: "The answer exists — in an old ticket, a runbook, or one senior tech's head. Finding it takes longer than fixing it.",
      },
    ],
    useCases: [
      {
        title: "Service-desk agents",
        body: "Tier-1 tickets triaged, deduplicated, and resolved automatically against your runbooks — escalating to techs with full context.",
      },
      {
        title: "Knowledge & runbook assistants",
        body: "Ask across every past ticket, doc, and config — answers with citations, so junior techs work like senior ones.",
      },
      {
        title: "White-label AI for your clients",
        body: "We build the agents; you sell them under your brand. A new recurring line item on every managed contract.",
      },
      {
        title: "PSA / RMM integrations",
        body: "MCP connectors for ConnectWise, Autotask, or HaloPSA — agents that live inside your actual workflow.",
      },
    ],
    ctaHeading: "Add AI to your stack — and your offering",
    ctaBody:
      "Tell us about your shop and book a free 30-minute strategy call — we'll map both your internal automation and a white-label play.",
  },
  {
    slug: "law-firms",
    name: "Law Firms",
    short: "law firms",
    headline: "Your firm runs on documents. Let AI do the heavy lifting.",
    subhead:
      "Custom AI agents that handle intake, research, and document drafting — built privately for your firm, integrated with the tools you already use.",
    painPoints: [
      {
        title: "Intake leaks billable hours",
        body: "Every new-client call, conflict check, and engagement letter eats attorney time that should be billed — or burns staff you can't hire fast enough.",
      },
      {
        title: "Document review doesn't scale",
        body: "Contracts, discovery, and case files pile up. Associates grind through them manually while deadlines compress.",
      },
      {
        title: "Off-the-shelf AI isn't confidential",
        body: "You can't paste client matters into a public chatbot. You need AI that runs under your control, with your data governance.",
      },
    ],
    useCases: [
      {
        title: "AI-powered client intake",
        body: "An agent that interviews prospects, runs conflict checks, drafts engagement letters, and books consults — 24/7, without staff.",
      },
      {
        title: "Document drafting & review agents",
        body: "First-draft contracts, demand letters, and summaries generated from your templates and precedent — attorneys review, not write.",
      },
      {
        title: "Case-file research assistants",
        body: "Ask questions across thousands of pages of discovery and case history, with citations back to the source documents.",
      },
      {
        title: "Practice-management integrations",
        body: "MCP connectors that let AI work inside Clio, MyCase, or your DMS — so automation lives where your matters do.",
      },
    ],
    ctaHeading: "See what AI could automate at your firm",
    ctaBody:
      "Tell us about your practice and book a free 30-minute strategy call — we'll map the highest-leverage automations, no pitch.",
  },
];

export function getIndustry(slug: string): Industry | undefined {
  return INDUSTRIES.find((i) => i.slug === slug);
}
