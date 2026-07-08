import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { db } from "@/db";
import { parseRetellArgs, voiceAuthed } from "@/lib/voice-booking";

export const dynamic = "force-dynamic";

/** neon-http returns either an array or { rows }. Normalize to rows. */
function rowsOf(res: unknown): Record<string, unknown>[] {
  return (Array.isArray(res) ? res : (res as { rows?: unknown }).rows ?? []) as Record<string, unknown>[];
}

/**
 * Retell custom function: `verify_code`.
 * The receptionist reads back a caller's ACCOUNT NUMBER (e.g. 100001) or a site
 * CLAIM CODE (TBJ-XXXX-XXXX) to confirm it's real and pull up which business it's
 * for. Read-only — no PII beyond the (already-public) business name is returned, and
 * the endpoint is bearer-protected so only the voice agent can call it.
 * Args: { code: string }
 * → { valid, kind: "account"|"claim_code", businessName?, claimed?/hasClaimedSite? , message }
 */
export async function POST(req: Request) {
  if (!voiceAuthed(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ valid: false, message: "Sorry, I didn't catch that — could you read the code again?" });
  }
  const args = parseRetellArgs(body);
  const raw = typeof args.code === "string" ? args.code : "";
  const norm = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!norm) {
    return NextResponse.json({ valid: false, message: "I didn't catch a code — could you read it to me again?" });
  }
  const isAccountNumber = /^\d{4,}$/.test(norm); // account numbers are all digits (100001…)

  // 1) Claim code (TBJ-XXXX-XXXX) — match ignoring case + dashes/spaces.
  if (!isAccountNumber) {
    const site = rowsOf(
      await db.execute(sql`SELECT business_name, claimed_by_user_id, status
                           FROM forge_sites
                           WHERE upper(replace(claim_code, '-', '')) = ${norm}
                           LIMIT 1`),
    )[0];
    if (site) {
      const claimed = Boolean(site.claimed_by_user_id) || site.status === "claimed";
      const businessName = String(site.business_name ?? "your business");
      return NextResponse.json({
        valid: true,
        kind: "claim_code",
        businessName,
        claimed,
        message: `That's the site for ${businessName}${claimed ? ", and it's already claimed to your account." : ", and it's still reserved for you to claim."}`,
      });
    }
  }

  // 2) Account number — confirm the account exists + name the claimed site, if any.
  const user = rowsOf(
    await db.execute(sql`SELECT id FROM better_auth."user" WHERE account_number = ${norm} LIMIT 1`),
  )[0];
  if (user) {
    const site = rowsOf(
      await db.execute(sql`SELECT business_name FROM forge_sites WHERE claimed_by_user_id = ${String(user.id)} LIMIT 1`),
    )[0];
    const businessName = site ? String(site.business_name) : null;
    return NextResponse.json({
      valid: true,
      kind: "account",
      businessName,
      hasClaimedSite: Boolean(site),
      message: businessName
        ? `Found your account — it's linked to ${businessName}.`
        : `Found your account. You haven't claimed a site to it yet — I can walk you through that.`,
    });
  }

  return NextResponse.json({ valid: false, message: "I'm not finding that one — let's double-check the digits and try again." });
}
