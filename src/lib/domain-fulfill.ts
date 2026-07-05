import { eq } from "drizzle-orm";

import { db, forgeSites, activityLog } from "@/db";
import { notifyTelegram } from "@/lib/telegram";
import {
  quoteDomain,
  buyDomain,
  attachDomainToProject,
  projectFromLiveUrl,
  registrantContact,
  domainsLiveMode,
} from "@/lib/domains";

/**
 * Register a domain and point it at a site. Shared by the free-credit path and
 * the paid checkout webhook. Real purchase only in live mode with a registrant
 * contact configured; otherwise records intent (pending_setup) — no money spent.
 * Idempotent enough: sets forge_sites.domain + domain_status on the site.
 */
export async function fulfillDomain(
  siteId: number,
  domain: string,
  paid: boolean,
): Promise<{ status: string }> {
  const [site] = await db.select().from(forgeSites).where(eq(forgeSites.id, siteId)).limit(1);
  if (!site) return { status: "error" };

  let status = "registered";
  try {
    const quote = await quoteDomain(domain);
    const contact = registrantContact();
    if (domainsLiveMode() && contact && quote.available && quote.price != null) {
      await buyDomain(domain, quote.price, contact);
      const project = projectFromLiveUrl(site.liveUrl);
      if (project) await attachDomainToProject(project, domain);
    } else {
      // Test mode or no registrant contact yet — reserve it, finish manually.
      status = "pending_setup";
    }
  } catch (err) {
    console.error("[fulfillDomain] failed:", err);
    status = "failed";
  }

  await db
    .update(forgeSites)
    .set({ domain, domainStatus: status, updatedAt: new Date().toISOString() })
    .where(eq(forgeSites.id, siteId));

  await db.insert(activityLog).values({
    actor: paid ? "stripe" : "client",
    eventType: "domain_registered",
    summary: `${site.businessName}: ${domain} (${status})${paid ? " — paid" : " — free credit"}`,
    metadata: { auto: true, target: String(siteId), detail: { domain, status, paid } },
  });
  notifyTelegram(
    `🌐 <b>Domain ${status === "registered" ? "registered" : "reserved"}</b>\n${domain} → ${site.businessName}${paid ? " (paid)" : " (free credit)"}`,
  ).catch(() => {});

  return { status };
}
