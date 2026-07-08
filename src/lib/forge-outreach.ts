import { and, eq, isNotNull, sql } from "drizzle-orm";

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
    `If you'd like it, just create an account and enter the claim code below to claim your website — then you can take ownership and make any changes you want. It's reserved for you; no pressure.`,
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

/** The standard "text the link" SMS body (deterministic — same as the call-room button). */
export function smsText(l: { businessName: string; ownerName: string | null; liveUrl: string | null }): string {
  const first = l.ownerName ? l.ownerName.trim().split(/\s+/)[0] : "";
  return `Hi${first ? ` ${first}` : ""}, it's Joe — here's the site I built for ${l.businessName}: ${l.liveUrl || ""}`;
}

export type LeadHistoryEvent = {
  at: string;
  kind: "email-sent" | "call" | "text" | "email";
  label: string;
  subject?: string;
  body?: string;
};

type HistLead = {
  id: string | number; businessName: string; city: string | null; ownerName: string | null;
  googleRating: string | null; reviewCount: string | null; liveUrl: string | null;
};

/**
 * The contact/message history per lead — a follow-up-friendly timeline. Reads the logged touches
 * (forge_outreach_sent + manual call/text/email attempts) and reconstructs the exact message for
 * each (composeOutreach / smsText are deterministic, so the sent email + text read back accurately
 * even though only the event was logged). Keyed by site id, oldest → newest.
 */
export async function getLeadHistories(leads: HistLead[]): Promise<Record<string, LeadHistoryEvent[]>> {
  if (leads.length === 0) return {};
  const res = await db.execute(sql`
    SELECT (metadata->'detail'->>'siteId') AS site,
           (metadata->'detail'->>'channel') AS ch,
           event_type, created_at
    FROM activity_log
    WHERE event_type IN ('forge_outreach_sent','lead_contact_attempt')
      AND (metadata->'detail'->>'siteId') IS NOT NULL
    ORDER BY created_at ASC`);
  const rows = (Array.isArray(res) ? res : (res as { rows?: unknown }).rows ?? []) as Record<string, unknown>[];
  const byId: Record<string, HistLead> = {};
  for (const l of leads) byId[String(l.id)] = l;
  const out: Record<string, LeadHistoryEvent[]> = {};
  for (const r of rows) {
    const site = String(r.site);
    const lead = byId[site];
    if (!lead) continue;
    const at = new Date(r.created_at as string).toISOString();
    let ev: LeadHistoryEvent;
    if (r.event_type === "forge_outreach_sent") {
      const { subject, body } = composeOutreach(lead);
      ev = { at, kind: "email-sent", label: "Sent the intro email", subject, body };
    } else {
      const ch = String(r.ch || "email");
      if (ch === "call") ev = { at, kind: "call", label: "Called" };
      else if (ch === "text") ev = { at, kind: "text", label: "Texted the site link", body: smsText(lead) };
      else ev = { at, kind: "email", label: "Emailed (manual)" };
    }
    (out[site] ||= []).push(ev);
  }
  return out;
}
