import type { Metadata } from "next";
import { and, isNotNull, ne, sql } from "drizzle-orm";

import { db, forgeSites } from "@/db";
import { requireAdmin } from "@/lib/require-admin";
import { PLANS, type PlanKey } from "@/lib/plans";
import { ClientsList, type Client } from "./clients-list";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Clients", robots: { index: false, follow: false } };

/**
 * The Clients book — everyone who claimed their site + signed up (a lead who became a client).
 * Like the Leads page, but only real accounts, so Joe can quickly find the account he wants to
 * work with. Paying customers surface first; claimed-but-not-yet-paying sit below.
 */
export default async function ClientsPage() {
  await requireAdmin();

  const rows = await db
    .select({
      id: forgeSites.id, businessName: forgeSites.businessName, phone: forgeSites.phone,
      liveUrl: forgeSites.liveUrl, slug: forgeSites.slug, plan: forgeSites.plan,
      oneTimePaid: forgeSites.oneTimePaid, subscriptionStatus: forgeSites.subscriptionStatus,
      claimedByUserId: forgeSites.claimedByUserId, claimedAt: forgeSites.claimedAt,
      domain: forgeSites.domain, domainStatus: forgeSites.domainStatus,
      receptionistStatus: forgeSites.receptionistStatus,
    })
    .from(forgeSites)
    .where(and(isNotNull(forgeSites.claimedByUserId), ne(forgeSites.status, "deleted")));

  // Account details (number + email + name) from better-auth.
  const userIds = [...new Set(rows.map((r) => r.claimedByUserId).filter((x): x is string => !!x))];
  const users: Record<string, { email: string | null; name: string | null; accountNumber: string | null }> = {};
  if (userIds.length) {
    const res = await db.execute(sql`
      SELECT id, email, name, account_number FROM better_auth."user"
      WHERE id IN (${sql.join(userIds.map((id) => sql`${id}`), sql`, `)})`);
    for (const u of (Array.isArray(res) ? res : (res as { rows?: unknown }).rows ?? []) as Record<string, unknown>[]) {
      users[String(u.id)] = { email: u.email ? String(u.email) : null, name: u.name ? String(u.name) : null, accountNumber: u.account_number ? String(u.account_number) : null };
    }
  }

  const SITE = "https://thinkbigjoe.com";
  const clients: Client[] = rows
    .map((r): Client => {
      const u = r.claimedByUserId ? users[r.claimedByUserId] : undefined;
      const subActive = r.subscriptionStatus === "active" || r.subscriptionStatus === "trialing";
      const paid = !!r.oneTimePaid || subActive;
      return {
        siteId: r.id,
        businessName: r.businessName,
        ownerName: u?.name ?? null,
        ownerEmail: u?.email ?? null,
        accountNumber: u?.accountNumber ?? null,
        plan: r.plan ? PLANS[r.plan as PlanKey]?.label ?? r.plan : null,
        subscriptionStatus: r.subscriptionStatus ?? null,
        paid,
        phone: r.phone ?? null,
        siteUrl: r.liveUrl || (r.slug ? `${SITE}/s/${r.slug}` : null),
        domain: r.domain ?? null,
        domainStatus: r.domainStatus ?? null,
        receptionistStatus: r.receptionistStatus ?? null,
        claimedAt: r.claimedAt ?? null,
      };
    })
    .sort((a, b) => Number(b.paid) - Number(a.paid) || (b.claimedAt || "").localeCompare(a.claimedAt || ""));

  return (
    <div className="px-4 py-6 sm:px-6">
      <div className="mx-auto w-full max-w-5xl">
        <ClientsList clients={clients} />
      </div>
    </div>
  );
}
