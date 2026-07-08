import { and, eq, isNotNull } from "drizzle-orm";

import { db, forgeSites } from "@/db";

/**
 * The owner-outreach message for a built site — "I built you a website, claim it."
 * Shared by the 10am sender (/api/forge/send-outreach) and the dashboard review
 * (/command/outreach) so what you preview is exactly what goes out. The branded
 * wrapper (claim-code block + "See your new site" + "Book a call", reply-to Joe)
 * is added by sendForgeOutreachEmail — this is just the personal message.
 */
export function composeOutreach(s: {
  businessName: string; city: string | null; ownerName: string | null;
  googleRating: string | null; reviewCount: string | null;
}): { subject: string; body: string } {
  const first = s.ownerName ? s.ownerName.trim().split(/\s+/)[0] : "";
  const rating = s.googleRating ? Number(s.googleRating) : 0;
  const reviews = s.reviewCount ? Number(s.reviewCount) : 0;
  const repBit = rating
    ? ` your ${rating}★ reputation${reviews ? ` across ${reviews}+ reviews` : ""}`
    : " the way you show up for your customers";
  const body = [
    `Hi${first ? ` ${first}` : ""} — I'm Joe. I came across ${s.businessName}${s.city ? ` in ${s.city}` : ""} and${repBit}, so I went ahead and built you a brand-new website (you can see it right below).`,
    `It's a real, finished site — your services, mobile-friendly, and fast. I built it on spec because I think ${s.businessName} deserves a site that matches how good you are at the work.`,
    `If you like it, it's yours: create a free account, enter the claim code below, and you can take ownership and edit anything. No obligation, and it's reserved for you.`,
  ].join("\n\n");
  return { subject: `I built ${s.businessName} a new website — take a look`, body };
}

export type OutreachQueueItem = {
  id: number;
  businessName: string;
  email: string | null;
  liveUrl: string | null;
  claimCode: string | null;
  status: "queued" | "sent" | "skipped" | "needs-email";
  subject: string;
  body: string;
};

/** Every marketing-approved built site with its composed message + send status — feeds the review UI. */
export async function getOutreachQueue(): Promise<OutreachQueueItem[]> {
  const rows = await db
    .select({
      id: forgeSites.id, businessName: forgeSites.businessName, email: forgeSites.email,
      liveUrl: forgeSites.liveUrl, claimCode: forgeSites.claimCode, city: forgeSites.city,
      ownerName: forgeSites.ownerName, googleRating: forgeSites.googleRating,
      reviewCount: forgeSites.reviewCount, outreachStatus: forgeSites.outreachStatus,
    })
    .from(forgeSites)
    .where(and(eq(forgeSites.status, "built"), isNotNull(forgeSites.marketingApprovedAt)))
    .orderBy(forgeSites.businessName);

  return rows.map((r) => {
    const { subject, body } = composeOutreach(r);
    const os = r.outreachStatus;
    const status: OutreachQueueItem["status"] =
      os === "sent" ? "sent" : os === "skipped" ? "skipped" : !r.email ? "needs-email" : "queued";
    return { id: r.id, businessName: r.businessName, email: r.email, liveUrl: r.liveUrl, claimCode: r.claimCode, status, subject, body };
  });
}
