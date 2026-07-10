import type { Metadata } from "next";
import Link from "next/link";
import { and, desc, eq, isNotNull, or, sql } from "drizzle-orm";

import { db, forgeSites } from "@/db";
import { requireAdmin } from "@/lib/require-admin";
import { type ForgeSiteItem } from "../sites/sites-queue";
import { getLeadHistories, getPendingReplies, type LeadHistoryEvent } from "@/lib/forge-outreach";
import { PLANS, type PlanKey } from "@/lib/plans";
import { LeadsCRM, type AttemptStat, type LeadMeta, type LeadStage } from "./leads-crm";
import { RepliesInbox } from "./replies-inbox";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Leads",
  robots: { index: false, follow: false },
};

export default async function LeadsPage() {
  await requireAdmin();

  // The call room = the contact list: every site approved for marketing OR built (excluding
  // denied/deleted). Newest first; the CRM re-sorts client-side.
  const webDevRows = await db
    .select()
    .from(forgeSites)
    .where(and(sql`status NOT IN ('denied','deleted')`, or(isNotNull(forgeSites.marketingApprovedAt), eq(forgeSites.status, "built"))))
    .orderBy(desc(forgeSites.createdAt));

  // The full contact book — every marketing-approved / built business, INCLUDING the ones that
  // claimed + signed up. We keep converted contacts visible (as "User"/"Customer" stages) so Joe
  // can see who actually signed up; the pipeline stage is computed per-row below.
  const webDevLeads: ForgeSiteItem[] = webDevRows
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
      hasPreview: !!r.preview,
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
  // Deliverability: a bounced lead's emails did NOT reach anyone — they're FAILED attempts, not
  // successful touches. `total` counts only real contact (delivered email, text, call); `failed`
  // tracks the bounced sends separately so we never show a bounced lead as "contacted".
  const bouncedIds = new Set(webDevLeads.filter((l) => l.outreachStatus === "bounced").map((l) => l.id));
  const attempts: Record<string, AttemptStat> = {};
  for (const r of attemptRows) {
    const site = String(r.site);
    const ch = String(r.ch || "email");
    const n = Number(r.n) || 0;
    const at = r.last_at ? new Date(r.last_at as string).toISOString() : null;
    const cur = attempts[site] || { call: 0, text: 0, email: 0, failed: 0, total: 0, lastAt: null };
    if (ch === "call") { cur.call += n; cur.total += n; }
    else if (ch === "text") { cur.text += n; cur.total += n; }
    else if (bouncedIds.has(site)) { cur.failed += n; } // email to a bounced address — failed, not a touch
    else { cur.email += n; cur.total += n; }
    if (at && (!cur.lastAt || at > cur.lastAt)) cur.lastAt = at;
    attempts[site] = cur;
  }

  // Contact/message history per lead (the follow-up timeline).
  const histories: Record<string, LeadHistoryEvent[]> = await getLeadHistories(webDevLeads);

  // Inbound email replies awaiting a response (poller pre-drafts them).
  const pendingReplies = await getPendingReplies();

  // CRM stage + user-profile enrichment per contact. A lead → contact (we reach out) → user
  // (claimed a site + signed up) → customer (paying). Account number comes from better_auth.user.
  const claimedUserIds = webDevRows.map((r) => r.claimedByUserId).filter((x): x is string => !!x);
  const acctByUser: Record<string, string | null> = {};
  if (claimedUserIds.length > 0) {
    const res = await db.execute(sql`
      SELECT id, account_number FROM better_auth."user"
      WHERE id IN (${sql.join(claimedUserIds.map((id) => sql`${id}`), sql`, `)})`);
    for (const r of (Array.isArray(res) ? res : (res as { rows?: unknown }).rows ?? []) as Record<string, unknown>[]) {
      acctByUser[String(r.id)] = r.account_number ? String(r.account_number) : null;
    }
  }
  const rowById = new Map(webDevRows.map((r) => [String(r.id), r]));
  const leadMeta: Record<string, LeadMeta> = {};
  for (const lead of webDevLeads) {
    const row = rowById.get(lead.id);
    const a = attempts[lead.id];
    const hist = histories[lead.id] || [];
    // Paying = a real recurring subscription OR a one-time payment (not just the legacy boolean).
    const subActive = row?.subscriptionStatus === "active" || row?.subscriptionStatus === "trialing";
    const paid = !!row?.oneTimePaid || subActive;
    const claimed = !!row?.claimedByUserId;
    let stage: LeadStage;
    if (paid) stage = "customer";
    else if (claimed) stage = "claimed";
    else if (lead.outreachStatus === "bounced") stage = "bounced";
    else if (hist.some((h) => h.kind === "reply")) stage = "replied";
    else if ((a?.total ?? 0) > 0 || lead.outreachStatus === "sent") stage = "contacted";
    else stage = "new";
    leadMeta[lead.id] = {
      stage,
      accountNumber: row?.claimedByUserId ? acctByUser[row.claimedByUserId] ?? null : null,
      plan: row?.plan ? PLANS[row.plan as PlanKey]?.label ?? row.plan : null,
      paid,
      subscriptionStatus: row?.subscriptionStatus ?? null,
      paidAt: row?.paidAt ?? null,
      receptionistStatus: row?.receptionistStatus && row.receptionistStatus !== "none" ? row.receptionistStatus : null,
      domain: row?.domain ?? null,
      domainStatus: row?.domainStatus ?? null,
      claimedAt: row?.claimedAt ?? null,
    };
  }

  return (
    <div className="px-6 py-8">
      <div className="mx-auto w-full max-w-4xl">

        {/* ── Header + cross-nav to the prospecting pipeline ── */}
        <div className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Leads</h1>
            <p className="mt-1 text-sm text-ink-soft">
              Every business we&apos;re working, by pipeline stage. Tap a contact for their info, communication
              history, and a calling script. Prospecting finds &amp; enriches leads → they land here.
            </p>
          </div>
          <Link href="/command/prospects" className="rounded-full border border-line px-3 py-1.5 text-sm font-semibold text-brand hover:bg-brand-tint/40">
            ← Prospecting pipeline
          </Link>
        </div>

        {/* ── Email replies awaiting a response (draft → review → send) ── */}
        {pendingReplies.length > 0 && (
          <section className="mb-10">
            <div className="mb-1 flex items-center gap-3">
              <h2 className="text-xl font-extrabold tracking-tight">Replies to respond to</h2>
              <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                {pendingReplies.length} awaiting
              </span>
            </div>
            <p className="mb-4 text-sm text-ink-soft">
              A prospect emailed back. We pre-drafted a reply for you — edit it and hit send, or dismiss it.
              Nothing goes out until you click <span className="font-medium text-ink">Send reply</span>.
            </p>
            <RepliesInbox replies={pendingReplies} />
          </section>
        )}

        {/* ── The CRM: contacts by pipeline stage ── */}
        <section className="mb-10">
          {webDevLeads.length === 0 ? (
            <p className="rounded-2xl border border-line bg-background p-6 text-sm text-ink-soft">
              No contacts yet — built sites show up here once the forge finishes them.{" "}
              <Link href="/command/prospects" className="font-semibold text-brand hover:underline">Approve some in prospecting →</Link>
            </p>
          ) : (
            <LeadsCRM leads={webDevLeads} attempts={attempts} histories={histories} meta={leadMeta} />
          )}
        </section>

      </div>
    </div>
  );
}
