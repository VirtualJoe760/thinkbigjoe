import type { Metadata } from "next";
import Link from "next/link";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";

import { db, leads, prospects, replyDrafts, forgeSites } from "@/db";
import { requireAdmin } from "@/lib/require-admin";
import { type ForgeSiteItem } from "../sites/sites-queue";
import { getLeadHistories, type LeadHistoryEvent } from "@/lib/forge-outreach";
import { LeadsTable, type AttemptStat } from "./leads-table";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Leads",
  robots: { index: false, follow: false },
};

const SOURCE_LABEL: Record<string, string> = {
  "industry-page": "Industry page",
  "booking-page": "Booking page",
  "contact-form": "Contact form",
};

function statusPill(status: string) {
  const map: Record<string, string> = {
    new: "bg-brand-tint text-brand",
    booked: "bg-green-50 text-green-700",
    contacted: "bg-surface text-ink-soft",
    qualified: "bg-surface text-ink-soft",
    won: "bg-green-50 text-green-700",
    lost: "bg-surface text-red-600",
  };
  return map[status] || "bg-surface text-ink-soft";
}

function draftStatusPill(status: string) {
  if (status === "awaiting") return "bg-amber-50 text-amber-700";
  if (status === "approved") return "bg-blue-50 text-blue-700";
  if (status === "sent") return "bg-green-50 text-green-700";
  return "bg-surface text-ink-soft";
}

export default async function LeadsPage() {
  await requireAdmin();

  // Web-dev leads (built, unclaimed businesses — the ones to call), inbound form
  // leads, and LinkedIn replied prospects (in parallel).
  const [webDevRows, formLeads, repliedProspects] = await Promise.all([
    // Only sites APPROVED FOR MARKETING are leads — built-but-unapproved stay in prospecting review.
    db.select().from(forgeSites).where(and(eq(forgeSites.status, "built"), isNotNull(forgeSites.marketingApprovedAt))).orderBy(desc(forgeSites.marketingApprovedAt)),
    db.select().from(leads).orderBy(desc(leads.createdAt)).limit(200),
    db
      .select({
        id: prospects.id,
        name: prospects.name,
        company: prospects.company,
        title: prospects.title,
        vertical: prospects.vertical,
        profileUrl: prospects.profileUrl,
        updatedAt: prospects.updatedAt,
      })
      .from(prospects)
      .where(eq(prospects.status, "replied"))
      .orderBy(desc(prospects.updatedAt))
      .limit(50),
  ]);

  // Fetch the latest reply_draft for each replied prospect.
  const draftsByProspect: Record<number, { id: number; theirMessage: string | null; draft: string | null; status: string }> = {};
  if (repliedProspects.length > 0) {
    for (const rp of repliedProspects) {
      const draft = await db
        .select({
          id: replyDrafts.id,
          theirMessage: replyDrafts.theirMessage,
          draft: replyDrafts.draft,
          status: replyDrafts.status,
        })
        .from(replyDrafts)
        .where(eq(replyDrafts.prospectId, rp.id))
        .orderBy(desc(replyDrafts.createdAt))
        .limit(1)
        .then((r) => r[0] ?? null);
      if (draft) draftsByProspect[rp.id] = draft;
    }
  }

  const awaitingCount = Object.values(draftsByProspect).filter((d) => d.status === "awaiting").length;

  // Built businesses we haven't converted yet — callable leads.
  const webDevLeads: ForgeSiteItem[] = webDevRows
    .filter((r) => !r.claimedByUserId)
    .map((r) => ({
      id: String(r.id),
      slug: r.slug,
      businessName: r.businessName,
      niche: r.niche || "",
      city: r.city || "",
      serviceArea: r.serviceArea || "",
      phone: r.phone || "",
      email: r.email || "",
      existingWebsiteUrl: r.existingWebsiteUrl || "",
      brandColor: r.brandColor || "",
      theme: r.theme || "",
      googleRating: r.googleRating || "",
      reviewCount: r.reviewCount || "",
      googleMapsUrl: r.googleMapsUrl || "",
      linkedinUrl: r.linkedinUrl || "",
      status: r.status,
      fitReason: r.fitReason || "",
      source: r.source || "",
      notes: r.notes || "",
      liveUrl: r.liveUrl || "",
      screenshotUrl: r.screenshotUrl || "",
      buildStatus: r.buildStatus || "",
      deniedReason: r.deniedReason || "",
      claimCode: r.claimCode || "",
      claimed: Boolean(r.claimedByUserId),
      createdAt: r.createdAt,
      outreachStatus: r.outreachStatus || "none",
      outreachSubject: r.outreachSubject || "",
      outreachDraft: r.outreachDraft || "",
      contactedAt: r.contactedAt || "",
      followupCount: r.followupCount || 0,
      ownerName: r.ownerName || "",
      instagramUrl: r.instagramUrl || "",
      facebookUrl: r.facebookUrl || "",
      contactNotes: r.contactNotes || "",
      socialStats: (r.socialStats as ForgeSiteItem["socialStats"]) || null,
      reviewQuotes: (r.reviewQuotes as ForgeSiteItem["reviewQuotes"]) || [],
      callPrep: r.callPrep || "",
      photoUrl: r.photoUrl || "",
      marketingApprovedAt: r.marketingApprovedAt || "",
      revisionNote: r.revisionNote || "",
    }));

  // Reach-out attempts per lead: manual call/text/email clicks (lead_contact_attempt) + the
  // auto owner-outreach email (forge_outreach_sent). Keyed by site id → counts + last-tried.
  const attemptRes = await db.execute(sql`
    SELECT (metadata->'detail'->>'siteId') AS site,
           (metadata->'detail'->>'channel') AS ch,
           count(*)::int AS n, max(created_at) AS last_at
    FROM activity_log
    WHERE event_type IN ('lead_contact_attempt','forge_outreach_sent')
      AND metadata->'detail'->>'siteId' IS NOT NULL
    GROUP BY site, ch`);
  const attemptRows = (Array.isArray(attemptRes) ? attemptRes : (attemptRes as { rows?: unknown }).rows ?? []) as Record<string, unknown>[];
  const attempts: Record<string, AttemptStat> = {};
  for (const r of attemptRows) {
    const site = String(r.site);
    const ch = String(r.ch || "email");
    const n = Number(r.n) || 0;
    const at = r.last_at ? new Date(r.last_at as string).toISOString() : null;
    const cur = attempts[site] || { call: 0, text: 0, email: 0, total: 0, lastAt: null };
    if (ch === "call") cur.call += n;
    else if (ch === "text") cur.text += n;
    else cur.email += n; // email + any auto-outreach send
    cur.total += n;
    if (at && (!cur.lastAt || at > cur.lastAt)) cur.lastAt = at;
    attempts[site] = cur;
  }

  // Contact/message history per lead (the follow-up timeline).
  const histories: Record<string, LeadHistoryEvent[]> = await getLeadHistories(webDevLeads);

  return (
    <div className="px-6 py-8">
      <div className="mx-auto w-full max-w-4xl">

        {/* ── Header + cross-nav to the prospecting pipeline ── */}
        <div className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Leads — call room</h1>
            <p className="mt-1 text-sm text-ink-soft">
              Your ready-to-call leads, each with a photo, reviews, and a script. Prospecting is where leads are found &amp; enriched → they land here to call.
            </p>
          </div>
          <Link href="/command/prospects" className="rounded-full border border-line px-3 py-1.5 text-sm font-semibold text-brand hover:bg-brand-tint/40">
            ← Prospecting pipeline
          </Link>
        </div>

        {/* ── Web-dev leads (built businesses to call) ── */}
        <section className="mb-10">
          <div className="mb-1 flex items-center gap-3">
            <h2 className="text-xl font-extrabold tracking-tight">Ready to call</h2>
            <span className="rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-semibold text-green-700">
              {webDevLeads.length}
            </span>
          </div>
          <p className="mb-4 text-sm text-ink-soft">
            Businesses we built a site for and haven&apos;t converted yet. Click a row to open the script, reviews, and
            contact buttons. Every 📞/💬/✉️ tap is counted under <span className="font-medium text-ink">Attempts</span> so
            you can see who&apos;s been chased and how often.
          </p>
          {webDevLeads.length === 0 ? (
            <p className="rounded-2xl border border-line bg-background p-6 text-sm text-ink-soft">
              None to call yet — built sites show up here once the forge finishes them.{" "}
              <Link href="/command/prospects" className="font-semibold text-brand hover:underline">Approve some in prospecting →</Link>
            </p>
          ) : (
            <LeadsTable leads={webDevLeads} attempts={attempts} histories={histories} />
          )}
        </section>

        {/* ── LinkedIn replies ── */}
        {repliedProspects.length > 0 && (
          <section className="mb-10">
            <div className="mb-3 flex items-center gap-3">
              <h2 className="text-xl font-extrabold tracking-tight">LinkedIn replies</h2>
              {awaitingCount > 0 && (
                <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                  {awaitingCount} awaiting review
                </span>
              )}
            </div>
            <p className="mb-4 text-sm text-ink-soft">
              Prospects who replied on LinkedIn — review the conversation and approve a response.
            </p>
            <div className="space-y-3">
              {repliedProspects.map((rp) => {
                const draft = draftsByProspect[rp.id];
                return (
                  <Link
                    key={rp.id}
                    href={`/command/${rp.id}`}
                    className="block rounded-2xl border border-line bg-background p-5 transition-colors hover:border-brand hover:bg-brand-tint/30"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{rp.name}</span>
                      {rp.vertical && (
                        <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-ink-soft capitalize">
                          {rp.vertical}
                        </span>
                      )}
                      {draft && (
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${draftStatusPill(draft.status)}`}>
                          {draft.status === "awaiting" ? "needs review" : draft.status}
                        </span>
                      )}
                      <span className="ml-auto text-xs font-semibold text-brand">View conversation →</span>
                    </div>
                    {rp.title || rp.company ? (
                      <p className="mt-0.5 text-sm text-ink-soft">
                        {[rp.title, rp.company].filter(Boolean).join(" · ")}
                      </p>
                    ) : null}
                    {draft?.theirMessage && (
                      <p className="mt-2 line-clamp-2 rounded-xl bg-surface px-4 py-3 text-sm leading-relaxed text-ink">
                        &ldquo;{draft.theirMessage}&rdquo;
                      </p>
                    )}
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Inbound form leads ── */}
        <h1 className="text-2xl font-extrabold tracking-tight">Inbound leads</h1>
        <p className="mt-1 text-sm text-ink-soft">
          People who submitted the site forms (industry pages, booking intake, contact).
        </p>

        {formLeads.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-line bg-background p-10 text-center text-ink-soft">
            No inbound leads yet. They&apos;ll appear here as visitors submit the forms.
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            {formLeads.map((l) => (
              <div key={l.id} className="rounded-2xl border border-line bg-background p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{l.name}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusPill(String(l.status))}`}>
                    {l.status}
                  </span>
                  <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-ink-soft">
                    {SOURCE_LABEL[String(l.source)] || l.source}
                  </span>
                  {l.emailType === "business" && (
                    <span className="rounded-full bg-brand-tint px-2 py-0.5 text-xs font-medium text-brand">
                      business email
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-ink-soft">
                  <a href={`mailto:${l.email}`} className="hover:text-ink">
                    {l.email}
                  </a>
                  {l.company ? ` · ${l.company}` : ""}
                  {l.role ? ` · ${l.role}` : ""}
                  {l.phone ? ` · ${l.phone}` : ""}
                </p>
                {l.problem && (
                  <p className="mt-2 rounded-xl bg-surface px-4 py-3 text-sm leading-relaxed">
                    {l.problem}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
