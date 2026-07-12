import type { Metadata } from "next";
import { inArray, sql } from "drizzle-orm";

import { db, forgeSites, contactOverrides } from "@/db";
import { requireAdmin } from "@/lib/require-admin";
import { MessagesClient, type Conversation, type Msg } from "./messages-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Messages",
  robots: { index: false, follow: false },
};

/**
 * The texting inbox — every SMS conversation with a prospect (our first-touch, the
 * AI agent's replies, Joe's manual replies, and the prospect's inbound texts),
 * shown as named "contacts" (the business). Monitor the AI here + jump in.
 */
export default async function MessagesPage() {
  await requireAdmin();

  const rows = (
    await db.execute(sql`
      SELECT (metadata->'detail'->>'siteId')::int AS site,
             event_type AS et,
             metadata->'detail'->>'note' AS note,
             metadata->'detail'->>'via' AS via,
             created_at AS at
      FROM activity_log
      WHERE event_type IN ('sms_outreach_sent','sms_inbound','sms_outbound')
        AND (metadata->'detail'->>'siteId') ~ '^[0-9]+$'
        AND metadata->'detail'->>'note' IS NOT NULL
        AND metadata->'detail'->>'note' <> ''
      ORDER BY created_at ASC`)
  ).rows as Array<{ site: number; et: string; note: string; via: string | null; at: string }>;

  const bySite = new Map<number, Msg[]>();
  for (const r of rows) {
    const arr = bySite.get(r.site) || [];
    arr.push({
      dir: r.et === "sms_inbound" ? "in" : "out",
      text: r.note,
      at: new Date(r.at).toISOString(),
      via: r.via || (r.et === "sms_outreach_sent" ? "outreach" : undefined),
    });
    bySite.set(r.site, arr);
  }

  const siteIds = [...bySite.keys()];
  const sites = siteIds.length
    ? await db
        .select({
          id: forgeSites.id,
          businessName: forgeSites.businessName,
          phone: forgeSites.phone,
          city: forgeSites.city,
          niche: forgeSites.niche,
          rating: forgeSites.googleRating,
          reviews: forgeSites.reviewCount,
          outreachStatus: forgeSites.outreachStatus,
          claimCode: forgeSites.claimCode,
          claimed: forgeSites.claimedByUserId,
        })
        .from(forgeSites)
        .where(inArray(forgeSites.id, siteIds))
    : [];
  const info = new Map(sites.map((s) => [s.id, s]));

  // Name overrides (contact_overrides), keyed by the same phone string we store on forge_sites.
  const overrideRows = await db
    .select({ phone: contactOverrides.phone, name: contactOverrides.displayName })
    .from(contactOverrides);
  const overrideByPhone = new Map(overrideRows.map((o) => [o.phone, o.name]));

  const conversations: Conversation[] = siteIds
    .map((id): Conversation => {
      const msgs = bySite.get(id)!;
      const s = info.get(id);
      const last = msgs[msgs.length - 1];
      const override = s?.phone ? overrideByPhone.get(s.phone) : undefined;
      return {
        siteId: id,
        businessName: override || s?.businessName || "Unknown contact",
        customName: !!override,
        phone: s?.phone || "",
        city: s?.city || "",
        niche: s?.niche || "",
        rating: s?.rating || "",
        reviews: s?.reviews || "",
        claimCode: s?.claimCode || "",
        status: s?.claimed ? "claimed" : s?.outreachStatus === "opted_out" ? "opted_out" : "active",
        messages: msgs,
        lastText: last?.text || "",
        lastAt: last?.at || "",
        lastDir: last?.dir || "out",
        needsReply: last?.dir === "in",
      };
    })
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt));

  return (
    <div className="mx-auto flex h-[calc(100dvh-4rem)] w-full max-w-5xl flex-col">
      <MessagesClient conversations={conversations} />
    </div>
  );
}
