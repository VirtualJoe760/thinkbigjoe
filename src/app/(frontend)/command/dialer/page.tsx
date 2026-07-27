import type { Metadata } from "next";
import { sql } from "drizzle-orm";

import { db } from "@/db";
import { requireAdmin } from "@/lib/require-admin";
import { prospectSiteUrl } from "@/lib/forge-outreach";
import { DialerClient, type DialerLead } from "./dialer-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Dialer",
  robots: { index: false, follow: false },
};

/**
 * Dialer mode — Joe's call session, built to run on the Boost phone's browser. The queue is
 * server-built (callbacks due first, then call-prep-ready, then oldest-touched); each card is
 * tap-to-call via tel:, then a one-tap disposition auto-advances to the next lead. No Twilio:
 * the phone's native dialer places the call; this page is the brain (script + logging).
 */
export default async function DialerPage() {
  await requireAdmin();

  const res = await db.execute(sql`
    SELECT id, slug, business_name, niche, city, service_area, owner_name, phone, claim_code,
           google_rating, review_count, contact_notes, call_prep, live_url, existing_website_url,
           callback_at, callback_note,
           (callback_at IS NOT NULL AND callback_at <= now() + interval '2 hours') AS callback_due
    FROM forge_sites
    WHERE status <> 'deleted' AND phone IS NOT NULL AND claimed_by_user_id IS NULL
      AND ai_paused = false
      AND outreach_status IS DISTINCT FROM 'opted_out'
      AND lead_stage IS DISTINCT FROM 'declined'
      AND (is_internal IS NOT TRUE)
    ORDER BY (callback_at IS NOT NULL AND callback_at <= now() + interval '2 hours') DESC,
             callback_at ASC NULLS LAST,
             (call_prep IS NOT NULL) DESC,
             contacted_at ASC NULLS FIRST
    LIMIT 60`);
  const rows = (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as Record<string, unknown>[];

  const queue: DialerLead[] = rows.map((r) => ({
    id: Number(r.id),
    businessName: String(r.business_name),
    ownerName: r.owner_name ? String(r.owner_name) : null,
    phone: String(r.phone),
    niche: r.niche ? String(r.niche) : null,
    city: r.city ? String(r.city) : (r.service_area ? String(r.service_area) : null),
    rating: r.google_rating ? String(r.google_rating) : null,
    reviews: r.review_count ? String(r.review_count) : null,
    notes: r.contact_notes ? String(r.contact_notes) : null,
    callPrep: r.call_prep ? String(r.call_prep) : null,
    previewUrl: prospectSiteUrl({ liveUrl: r.live_url as string | null, slug: r.slug as string | null }),
    existingSite: r.existing_website_url ? String(r.existing_website_url) : null,
    claimCode: r.claim_code ? String(r.claim_code) : null,
    callbackDue: r.callback_due === true,
    callbackNote: r.callback_note ? String(r.callback_note) : null,
  }));

  return (
    <div className="mx-auto max-w-xl px-4 py-4">
      <DialerClient queue={queue} />
    </div>
  );
}
