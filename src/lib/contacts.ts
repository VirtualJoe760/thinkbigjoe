/**
 * TBJ's contact model — one row per PERSON we deal with, in the `contacts` table.
 *
 * This is ThinkBigJoe's own CRM: the scraped business owner, an enriched decision-maker, an inbound
 * web-form lead, and the owner once they claim their site (same person, `lifecycle` advances). It is
 * NOT the client's customers — those live in `newsletter_contacts` and the client's own Google
 * Contacts, and must never be pulled in here (see docs/CONTACTS.md).
 *
 * Migration note: `forge_sites` still carries the legacy contact columns (email/phone/owner_name/…)
 * because the live senders read them directly. This table is the new source of truth; the senders
 * are cut over separately, deliberately — not while the outreach engine is firing.
 */
import { and, desc, eq, sql } from "drizzle-orm";

import { db, contacts, forgeSites } from "@/db";

export type Contact = typeof contacts.$inferSelect;

export type ContactRole = "owner" | "decision_maker" | "inbound_lead" | "other";
export type ContactLifecycle = "prospect" | "lead" | "client" | "past_client";
export type ContactSource = "scrape" | "enrichment" | "inbound" | "claim" | "manual";

/** The site's primary (owner) contact, if one exists. */
export async function getOwnerContact(siteId: number): Promise<Contact | null> {
  const [c] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.siteId, siteId), eq(contacts.role, "owner")))
    .limit(1);
  return c ?? null;
}

/** The owner contact for the site a portal user has claimed (most recent claim first). */
export async function getOwnerContactForUser(userId: string): Promise<Contact | null> {
  const [c] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.userId, userId), eq(contacts.role, "owner")))
    .orderBy(desc(contacts.updatedAt))
    .limit(1);
  return c ?? null;
}

/** Fields a portal user (or admin) may edit from Settings. */
export type EditableContact = {
  businessName?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  serviceArea?: string | null;
  websiteUrl?: string | null;
  instagramUrl?: string | null;
  facebookUrl?: string | null;
  linkedinUrl?: string | null;
  notes?: string | null;
};

const clean = (v: string | null | undefined) => {
  const s = (v ?? "").trim();
  return s === "" ? null : s;
};

/**
 * Ensure a site has an owner contact, creating it from the site's own scraped fields if missing.
 * Idempotent — safe to call on every claim / every Settings load. Returns the row.
 */
export async function ensureOwnerContact(siteId: number, userId?: string | null): Promise<Contact | null> {
  const existing = await getOwnerContact(siteId);
  if (existing) {
    // Attach the claiming user + advance lifecycle the first time they sign in.
    if (userId && existing.userId !== userId) {
      const [row] = await db
        .update(contacts)
        .set({ userId, lifecycle: "client", updatedAt: sql`now()` })
        .where(eq(contacts.id, existing.id))
        .returning();
      return row ?? existing;
    }
    return existing;
  }

  const [site] = await db.select().from(forgeSites).where(eq(forgeSites.id, siteId)).limit(1);
  if (!site) return null;
  const [row] = await db
    .insert(contacts)
    .values({
      siteId,
      role: "owner",
      lifecycle: userId || site.claimedByUserId ? "client" : "prospect",
      businessName: site.businessName,
      name: site.ownerName ?? null,
      email: site.email ?? null,
      phone: site.phone ?? null,
      address: (site as { address?: string | null }).address ?? null,
      city: site.city ?? null,
      serviceArea: site.serviceArea ?? null,
      websiteUrl: site.liveUrl ?? null,
      instagramUrl: site.instagramUrl ?? null,
      facebookUrl: site.facebookUrl ?? null,
      linkedinUrl: site.linkedinUrl ?? null,
      notes: site.contactNotes ?? null,
      source: "scrape",
      userId: userId ?? site.claimedByUserId ?? null,
    })
    .onConflictDoNothing()
    .returning();
  return row ?? (await getOwnerContact(siteId));
}

/** Update an owner contact's editable fields (from Settings). Returns the updated row. */
export async function updateOwnerContact(siteId: number, patch: EditableContact): Promise<Contact | null> {
  const set: Record<string, unknown> = { updatedAt: sql`now()` };
  for (const [k, v] of Object.entries(patch)) set[k] = clean(v as string | null | undefined);
  const [row] = await db
    .update(contacts)
    .set(set)
    .where(and(eq(contacts.siteId, siteId), eq(contacts.role, "owner")))
    .returning();
  return row ?? null;
}
