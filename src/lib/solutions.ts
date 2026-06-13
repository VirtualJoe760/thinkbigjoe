/**
 * Example solution archetypes — illustrative of the kind of custom work we
 * develop, NOT a product catalog. Deliberately no pricing and no "buy" framing:
 * every engagement is custom-scoped (a build invoice + an ongoing partnership),
 * quoted per project, never advertised as a fixed price. These exist to show a
 * business what developing a solution in their world looks like, and to
 * cross-link into the matching industry landing page.
 */

export interface Solution {
  slug: string;
  name: string;
  /** Industries this kind of work tends to land in. */
  verticals: string;
  /** The problem, in the business's own terms. */
  problem: string;
  /** What a solution like this does, outcome-first. */
  delivers: string[];
  /** How it's built — the bespoke, embedded craft (no SaaS equivalent). */
  craft: string;
  /** Best-fit industry slug for the landing-page cross-link. */
  industry: string;
}

export const SOLUTIONS: Solution[] = [
  {
    slug: "document-intake-agent",
    name: "Document intake & processing",
    verticals: "Finance & insurance · Law firms",
    problem:
      "Applications, claims, contracts, and case files arrive as email and PDF, and your team spends its days collecting, checking, and re-keying them — the single biggest time sink in a document-heavy business.",
    delivers: [
      "Reads, classifies, and extracts the data from your documents automatically",
      "Flags exceptions — missing items, risk, conflicts — for a human to review",
      "Files everything into your system of record, so nothing lives in an inbox",
    ],
    craft:
      "We train it on your document types and your rules, and wire it into your CRM, AMS, LOS, or DMS through MCP — so it works inside the systems your team already uses, not as one more tab to check.",
    industry: "financial-services",
  },
  {
    slug: "service-desk-agent",
    name: "Service-desk & internal support",
    verticals: "MSPs & IT services",
    problem:
      "Tier-1 tickets — password resets, status checks, the same known issues — burn the hours your best people should spend on real work, and the answer is usually buried in an old ticket or one senior tech's head.",
    delivers: [
      "Triages, deduplicates, and resolves routine tickets against your runbooks",
      "Answers from your past tickets, docs, and configs — with citations",
      "Hands anything it can't solve to a person, with the full context attached",
    ],
    craft:
      "Built into your PSA/RMM (ConnectWise, Autotask, HaloPSA) through MCP, and — for MSPs — deployable under your own brand, so it becomes part of what you offer your clients.",
    industry: "msps",
  },
  {
    slug: "order-intake-agent",
    name: "Quote & order intake",
    verticals: "Manufacturing & logistics",
    problem:
      "RFQs, purchase orders, and order changes arrive as emails and PDFs that someone has to re-key into the ERP — slow, error-prone, and dependent on staff that's hard to hire and keep.",
    delivers: [
      "Reads RFQs and POs and pulls out the line items, quantities, and terms",
      "Prices and validates each one against your business rules",
      "Stages it in your ERP for a quick human approval — never blind transcription",
    ],
    craft:
      "The value is in the fit: we build it around your part numbers, customer-specific pricing, and order logic, integrated into your ERP/WMS/EDI flows. Nothing off-the-shelf knows your business this well.",
    industry: "manufacturing",
  },
];

export function getSolution(slug: string): Solution | undefined {
  return SOLUTIONS.find((s) => s.slug === slug);
}
