import { and, eq, isNotNull, sql } from "drizzle-orm";

import { db, forgeSites, forgeReplies } from "@/db";

const SITE_ORIGIN = (process.env.NEXT_PUBLIC_SITE_URL || "https://thinkbigjoe.com").replace(/\/+$/, "");

/**
 * A prospect's site as a FULL, clickable absolute URL (always with `https://`) — so texts and
 * link previews render it as a tappable link, never a bare `thinkbigjoe.com/s/…`. Prefers the
 * live URL, falls back to the hosted preview `/s/<slug>`, then the site root.
 */
export function prospectSiteUrl(p: { liveUrl?: string | null; slug?: string | null }): string {
  const raw = (p.liveUrl && p.liveUrl.trim()) || (p.slug ? `${SITE_ORIGIN}/s/${p.slug}` : SITE_ORIGIN);
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw.replace(/^\/+/, "")}`;
}

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
  // TRANSPARENT framing (docs/COLD_EMAIL.md): a PREVIEW we made, not "your finished website" —
  // honest pipeline (preview → their OK → full build → they customize) + the voice-led offer.
  // SHORT on purpose (Joe, 2026-07-26): ~70 words, three beats — who/why, the offer, the ask.
  const body = [
    `Hi${first ? ` ${first}` : ""} — Mark with ThinkBigJoe, a Web & AI agency. I noticed${repBit}, so we made ${s.businessName} a free website preview — it's below. If you like it, we build the full site and you customize everything. Plans start at $99/mo — and for a bit more, our AI receptionist answers every call and books your jobs.`,
    `Worth a quick Zoom this week? Grab a time: ${SITE_ORIGIN}/book-appointment — or call (480) 764-2121 and our concierge will book you in.`,
  ].join("\n\n");
  return { subject: `a website preview for ${s.businessName}`, body };
}

/**
 * First-touch outreach SMS — Joe's approved voice. Short + personal: he built
 * them a site, here's the link + claim code, with a required STOP opt-out. The
 * fuller pitch (AI voice, agentic) lives in email + follow-ups so the text reads
 * like a real person, not a wall of copy.
 */
export function composeSmsOutreach(p: {
  businessName: string;
  ownerName: string | null;
  liveUrl: string | null;
  slug: string | null;
  claimCode: string | null;
  googleRating?: string | null;
  reviewCount?: string | null;
}): string {
  const site = prospectSiteUrl(p);
  const rating = p.googleRating ? Number(p.googleRating) : 0;
  const reviews = p.reviewCount ? Number(p.reviewCount) : 0;
  // Casual + human — no fake name, no claim code up front. Just a friendly opener
  // that gets a reply; the agent hands over the claim code once they respond.
  // Only claims "awesome reviews" when it's actually true.
  // TRANSPARENT framing (docs/COLD_EMAIL.md, 2026-07-26): it's a PREVIEW, not "the website I made
  // you" — that claim read as a scam to recipients (2.9% reply rate, one "scammer" reply verbatim).
  // Honest pipeline: preview → their OK → we build the full site → they customize.
  const opener =
    rating && reviews >= 5
      ? `Hi, this is Mark with ThinkBigJoe, a Web & AI agency. Saw ${p.businessName}'s great reviews but no website, so we made a free preview of what one could look like:`
      : `Hi, this is Mark with ThinkBigJoe, a Web & AI agency. Came across ${p.businessName} and noticed you don't have a website, so we made a free preview of what one could look like:`;
  return `${opener} ${site} — if you like it, we build the full site and you can customize everything. Worth a look? (Not interested? Just reply 'No thanks' and I'll stop.)`;
}

/**
 * The text that follows a ringless voicemail drop — references the voicemail ("did you get my
 * voicemail?") since the call is the opener now. Like the plain opener: full https link, no claim
 * code up front (the agent hands the code over once they reply).
 */
export function composeVoicemailFollowupSms(p: { liveUrl: string | null; slug: string | null }): string {
  const site = prospectSiteUrl(p);
  return `Hey, did you get my voicemail? This is Mark with ThinkBigJoe. We made a free preview of what a website for your business could look like: ${site} — if you like it, we build the full site and you customize it however you want. Worth a look? (Not interested? Just reply 'No thanks' and I'll stop.)`;
}

/**
 * Follow-up text for the case where the voicemail did NOT land (delivery failed, or we never got
 * a delivery confirmation). Must NOT reference a voicemail — many of these people never got one.
 */
export function composeVoicemailFallbackSms(p: { liveUrl: string | null; slug: string | null }): string {
  const site = prospectSiteUrl(p);
  return `Hey, it's Mark with ThinkBigJoe — just tried to reach you. We made a free preview of what a website for your business could look like: ${site} — if you like it, we build the full site and you can customize everything. Worth a look? (Not interested? Just reply 'No thanks' and I'll stop.)`;
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

export type PendingReply = {
  id: number;
  siteId: number;
  businessName: string;
  liveUrl: string | null;
  fromEmail: string | null;
  subject: string | null;
  inboundText: string | null;
  draft: string | null;
  createdAt: string;
};

/**
 * Inbound replies awaiting Joe's review. Each row was created by the inbox poller
 * (scripts/inbox-poll.mjs) when a prospect wrote back — with a Gemini-drafted response
 * pre-written. Joe reviews/edits the draft and sends (draft → approve → send). Newest first.
 */
export async function getPendingReplies(): Promise<PendingReply[]> {
  const rows = await db
    .select({
      id: forgeReplies.id, siteId: forgeReplies.siteId, fromEmail: forgeReplies.fromEmail,
      subject: forgeReplies.subject, inboundText: forgeReplies.inboundText, draft: forgeReplies.draft,
      createdAt: forgeReplies.createdAt, businessName: forgeSites.businessName, liveUrl: forgeSites.liveUrl,
    })
    .from(forgeReplies)
    .leftJoin(forgeSites, eq(forgeReplies.siteId, forgeSites.id))
    .where(eq(forgeReplies.status, "awaiting"))
    .orderBy(sql`${forgeReplies.createdAt} DESC`);
  return rows.map((r) => ({
    id: r.id, siteId: r.siteId, businessName: r.businessName ?? `Site #${r.siteId}`,
    liveUrl: r.liveUrl, fromEmail: r.fromEmail, subject: r.subject, inboundText: r.inboundText,
    draft: r.draft, createdAt: r.createdAt,
  }));
}

export type LeadHistoryEvent = {
  at: string;
  kind: "email-sent" | "call" | "text" | "email" | "bounce" | "reply" | "note" | "code" | "voicemail";
  /** Blob-hosted call recording (dialer uploads) — the timeline renders an <audio> for it. */
  recordingUrl?: string;
  label: string;
  subject?: string;
  body?: string;
  failed?: boolean; // an email that bounced / a code we couldn't text — attempted, not delivered
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
           (metadata->'detail'->>'subject') AS subject,
           (metadata->'detail'->>'snippet') AS snippet,
           (metadata->'detail'->>'note') AS note,
           (metadata->'detail'->>'code') AS code,
           (metadata->'detail'->>'sent') AS sent,
           (metadata->'detail'->>'recordingUrl') AS recording_url,
           (metadata->'detail'->>'disposition') AS disposition,
           event_type, created_at
    FROM activity_log
    WHERE event_type IN ('forge_outreach_sent','lead_contact_attempt','email_bounced','email_reply','email_reply_sent','lead_note','callback_code_sent','sms_outreach_sent','sms_inbound','sms_outbound','voicemail_dropped','voicemail_delivered','voicemail_failed','dial_call','dial_recording')
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
    } else if (r.event_type === "email_bounced") {
      ev = { at, kind: "bounce", label: "Bounced — didn't deliver", body: r.subject ? `Bounce: ${String(r.subject)}` : undefined };
    } else if (r.event_type === "email_reply") {
      ev = { at, kind: "reply", label: "Replied", subject: r.subject ? String(r.subject) : undefined, body: r.snippet ? String(r.snippet) : undefined };
    } else if (r.event_type === "email_reply_sent") {
      ev = { at, kind: "email", label: "Sent a reply", body: r.snippet ? String(r.snippet) : undefined };
    } else if (r.event_type === "lead_note") {
      ev = { at, kind: "note", label: "Note", body: r.note ? String(r.note) : undefined };
    } else if (r.event_type === "sms_inbound") {
      ev = { at, kind: "reply", label: "Texted back", body: r.note ? String(r.note) : undefined };
    } else if (r.event_type === "sms_outbound") {
      ev = { at, kind: "text", label: "We replied", body: r.note ? String(r.note) : undefined };
    } else if (r.event_type === "sms_outreach_sent") {
      ev = { at, kind: "text", label: "Texted (first touch)", body: r.note ? String(r.note) : smsText(lead) };
    } else if (r.event_type === "voicemail_dropped") {
      ev = { at, kind: "voicemail", label: "Dropped a voicemail" };
    } else if (r.event_type === "voicemail_delivered") {
      ev = { at, kind: "voicemail", label: "Voicemail delivered" };
    } else if (r.event_type === "voicemail_failed") {
      ev = { at, kind: "voicemail", label: "Voicemail failed", failed: true };
    } else if (r.event_type === "dial_call") {
      const d = String(r.disposition || "").replace(/_/g, " ");
      ev = { at, kind: "call", label: `Called${d ? ` — ${d}` : ""}`, body: r.note ? String(r.note) : undefined };
    } else if (r.event_type === "dial_recording") {
      ev = {
        at, kind: "call", label: "Call recording + AI notes",
        body: r.note ? String(r.note) : undefined,
        recordingUrl: r.recording_url ? String(r.recording_url) : undefined,
      };
    } else if (r.event_type === "callback_code_sent") {
      const delivered = String(r.sent) === "true";
      ev = {
        at,
        kind: "code",
        label: "Callback code",
        body: r.note ? String(r.note) : (r.code ? `Code ${r.code}` : undefined),
        failed: !delivered, // minted but not texted (SMS off / send failed)
      };
    } else {
      const ch = String(r.ch || "email");
      if (ch === "call") ev = { at, kind: "call", label: "Called" };
      else if (ch === "text") ev = { at, kind: "text", label: "Texted the site link", body: smsText(lead) };
      else ev = { at, kind: "email", label: "Emailed (manual)" };
    }
    (out[site] ||= []).push(ev);
  }
  // Deliverability truth: if a lead ever bounced, its email sends did NOT reach anyone —
  // mark every email-send failed so the UI shows a failed attempt, not a successful contact.
  for (const events of Object.values(out)) {
    if (events.some((e) => e.kind === "bounce")) {
      for (const e of events) {
        if (e.kind === "email-sent" || e.kind === "email") e.failed = true;
      }
    }
  }
  return out;
}
