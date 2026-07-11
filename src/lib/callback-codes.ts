import { and, eq } from "drizzle-orm";

import { db, callbackCodes } from "@/db";

/** The number leads text/call (the Twilio A2P sender). Calls to it reach Ivy. */
export const TBJ_PHONE_PRETTY = "760-262-0014";

/**
 * The message we text a lead so they can reach Joe directly: they call the TBJ
 * number, give the code, Ivy verifies it and transfers them straight to Joe.
 */
export function callbackCodeMessage(code: string, firstName?: string | null): string {
  const hi = firstName ? ` ${firstName}` : "";
  return `Hi${hi}, it's Joe from ThinkBigJoe. Call ${TBJ_PHONE_PRETTY} and give code ${code} — that connects you straight to me.`;
}

/**
 * Mint a 4-digit priority callback code, unique among currently-active codes (a
 * partial unique index enforces it too — we retry on the rare race). Used by the
 * lead-page "text a callback code" action and mirrored by the issue_callback_code
 * MCP tool.
 */
export async function mintCallbackCode(opts: {
  phone?: string | null;
  name?: string | null;
  forgeSiteId?: number | null;
  expiresHours?: number;
  issuedBy?: string;
}): Promise<string> {
  const hrs = Math.max(1, Math.min(24 * 60, opts.expiresHours ?? 720)); // cap 60 days
  const expiresAt = new Date(Date.now() + hrs * 3_600_000).toISOString();
  for (let i = 0; i < 10; i++) {
    const code = String(1000 + Math.floor(Math.random() * 9000)); // 1000–9999
    const [exists] = await db
      .select({ id: callbackCodes.id })
      .from(callbackCodes)
      .where(and(eq(callbackCodes.code, code), eq(callbackCodes.status, "active")))
      .limit(1);
    if (exists) continue;
    try {
      await db.insert(callbackCodes).values({
        code,
        contactPhone: opts.phone ?? null,
        leadName: opts.name ?? null,
        forgeSiteId: opts.forgeSiteId ?? null,
        status: "active",
        issuedBy: opts.issuedBy ?? "joe",
        expiresAt,
      });
      return code;
    } catch {
      /* active-unique collision — try another code */
    }
  }
  throw new Error("Couldn't mint a unique callback code — try again.");
}
