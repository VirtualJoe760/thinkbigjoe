/**
 * Productized offerings — the move from one-off custom invoicing toward
 * repeatable products with recurring revenue. Lineup and pricing structure
 * are research-backed (deep-research run 2026-06-12; see memory:
 * productized-solutions). Core principle from the data: AI products under
 * ~$250/mo churn brutally (23% GRR) while those over $250/mo retain (70% GRR),
 * so every offering is premium + embedded-via-MCP + sold as a MANAGED service,
 * not a thin self-serve subscription. Generic customer-service chatbots are
 * deliberately excluded (74% enterprise rollback rate).
 *
 * Pricing shown as "from" anchors — ranges calibrate per engagement. Monthly
 * is a managed-AI-operations retainer (hosting, monitoring, accuracy tuning,
 * model upgrades), which is what produces retention.
 */

export interface Solution {
  slug: string;
  name: string;
  tagline: string;
  verticals: string;
  /** The problem in one or two sentences. */
  problem: string;
  /** Bullet list of what the engagement includes. */
  includes: string[];
  setupFrom: string;
  monthlyFrom: string;
  /** Why a SaaS tool can't commoditize this. */
  moat: string;
  /** ROI / proof point to anchor value. */
  proof: string;
  /** Best-fit industry slug for the funnel handoff. */
  industry: string;
  featured?: boolean;
}

export const SOLUTIONS: Solution[] = [
  {
    slug: "document-intake-agent",
    name: "Document Intake & Processing Agent",
    tagline: "Stop re-keying paper. Agents read, validate, and file it.",
    verticals: "Finance & insurance · Law firms",
    problem:
      "Applications, claims, contracts, and case files arrive as email and PDF, and your team manually collects, checks, and re-keys them. It's the single biggest time sink in a document-heavy business.",
    includes: [
      "Custom classification + extraction trained on your document types",
      "Validation rules and exception flagging (missing items, risk, conflicts)",
      "MCP integration into your system of record — CRM, AMS, LOS, or DMS",
      "Human-in-the-loop review queue so nothing files unchecked",
      "Managed operations: hosting, monitoring, accuracy tuning, model upgrades",
    ],
    setupFrom: "$8,000",
    monthlyFrom: "$750",
    moat: "It lives inside your systems of record and is trained on your documents and compliance rules. A generic OCR or chatbot tool can't reach into your AMS or know your underwriting logic — so it can't be swapped out for a $40/mo subscription.",
    proof:
      "Documented legal example: AI-driven complaint response cut associate time from 16 hours to minutes, with higher accuracy.",
    industry: "financial-services",
    featured: true,
  },
  {
    slug: "msp-service-desk-agent",
    name: "White-Label Service-Desk Agent",
    tagline: "Build it once. Your MSP resells it to every client.",
    verticals: "MSPs & IT services",
    problem:
      "Tier-1 tickets — password resets, status checks, known issues — burn tech hours you could bill at project rates. Meanwhile your clients are asking you for AI you don't yet offer.",
    includes: [
      "Tier-1 triage, deduplication, and runbook-based resolution",
      "Knowledge assistant over past tickets, docs, and configs (with citations)",
      "MCP integration into your PSA/RMM — ConnectWise, Autotask, HaloPSA",
      "Deployed under YOUR brand, as a new line item on every managed contract",
      "Per-client provisioning so one build serves your whole book",
    ],
    setupFrom: "$10,000",
    monthlyFrom: "$1,000",
    moat: "The best scaling economics of the lineup: one build, deployed to all your clients through a single relationship. Service desk is the #1 production agentic use case, and the white-label model turns you into our channel.",
    proof:
      "51% of SMBs already buy technology through an MSP — the distribution is built in.",
    industry: "msps",
  },
  {
    slug: "order-intake-agent",
    name: "Quote & Order Intake Agent",
    tagline: "RFQs and POs into your ERP — without the transcription.",
    verticals: "Manufacturing & logistics",
    problem:
      "RFQs, purchase orders, and order changes arrive as emails and PDFs that someone re-keys into the ERP. It's slow, error-prone, and the skilled staff to do it are hard to hire.",
    includes: [
      "Parse RFQs, POs, and order changes from email and PDF",
      "Price and validate against your business rules",
      "MCP integration into your ERP / WMS / EDI flows",
      "Approval queue — your team confirms, never transcribes",
      "Managed operations and ongoing rule tuning",
    ],
    setupFrom: "$10,000",
    monthlyFrom: "$1,000",
    moat: "The ERP and pricing-logic integration is the moat. No off-the-shelf tool knows your part numbers, customer-specific pricing, or order rules — it's irreducibly tied to your systems.",
    proof:
      "Gartner forecasts supply-chain-management software with agentic AI growing from under $2B to $53B by 2030.",
    industry: "manufacturing",
  },
];

export function getSolution(slug: string): Solution | undefined {
  return SOLUTIONS.find((s) => s.slug === slug);
}
