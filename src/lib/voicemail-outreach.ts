import { and, eq, sql } from "drizzle-orm";

import { db, forgeSites, activityLog } from "@/db";
import { dropVoicemail, dropCowboyCallbackUrl } from "@/lib/dropcowboy";
import { sendSms } from "@/lib/sms";
import { composeVoicemailFollowupSms, composeVoicemailFallbackSms } from "@/lib/forge-outreach";
import { notifyTelegram } from "@/lib/telegram";

export type VmSite = {
  id: number;
  businessName: string;
  phone: string | null;
  ownerName?: string | null;
  claimCode: string | null;
  liveUrl: string | null;
  slug: string | null;
  googleRating?: string | null;
  reviewCount?: string | null;
};

export type VmDropOutcome = {
  ok: boolean;
  dropped: boolean;
  texted: boolean;
  message: string;
};

// Drop Cowboy rejects a 4th send to the same contact within 3 days ("Too Many Attempts", 4013).
// Stay under it: never drop if we've already dropped this lead 3× in the trailing 3 days.
const MAX_DROPS_PER_3_DAYS = 3;

/**
 * The "call, then follow up with a text" first-touch: drop a ringless voicemail and mark the lead
 * so the follow-up text is sent LATER — gated on Drop Cowboy's delivery webhook, not fired at the
 * same instant. A voicemail deposits onto the carrier's voicemail server and the device is notified
 * seconds-to-minutes later (visual voicemail lags most), so texting immediately means "did you get
 * my voicemail?" arrives before the voicemail does. Instead we set vm_text_pending; the webhook
 * (on delivered → the VM-referencing text; on failed → a non-VM text) or the ~8-min fallback sweep
 * sends it. Shared by the lead-page button, the batch cron, and the MCP tool. `dry` previews.
 */
export async function dropToSite(
  site: VmSite,
  opts: { withText?: boolean; dry?: boolean } = {},
): Promise<VmDropOutcome> {
  const withText = opts.withText ?? true;
  if (!site.phone) return { ok: false, dropped: false, texted: false, message: "No phone number on this lead." };

  if (opts.dry) {
    return { ok: true, dropped: false, texted: false, message: `DRY — would drop VM${withText ? " + gated text" : ""} to ${site.businessName}` };
  }

  // Rate-limit guard: Drop Cowboy fails the 4th drop to a contact within 3 days.
  const recentDrops = Number(
    (await db.execute(sql`
      SELECT count(*)::int AS n FROM activity_log
      WHERE event_type = 'voicemail_dropped'
        AND (metadata->'detail'->>'siteId') = ${String(site.id)}
        AND created_at > now() - interval '3 days'`)
    ).rows[0]?.n ?? 0,
  );
  if (recentDrops >= MAX_DROPS_PER_3_DAYS) {
    return { ok: false, dropped: false, texted: false, message: `Already dropped ${site.businessName} ${recentDrops}× in the last 3 days — Drop Cowboy would reject a 4th ("Too Many Attempts"). Try again later.` };
  }

  const drop = await dropVoicemail(site.phone, {
    foreignId: `site-${site.id}`,
    callbackUrl: dropCowboyCallbackUrl(),
  });

  if ("skipped" in drop) return { ok: false, dropped: false, texted: false, message: drop.reason };
  if ("error" in drop) return { ok: false, dropped: false, texted: false, message: `Voicemail failed: ${drop.error}` };

  await db.insert(activityLog).values({
    actor: "dropcowboy",
    eventType: "voicemail_dropped",
    summary: `📞 Dropped a voicemail to ${site.businessName}${drop.id ? ` (${drop.id})` : ""}`,
    metadata: { detail: { siteId: site.id, note: "Dropped a ringless voicemail", to: site.phone, rvmId: drop.id ?? null } },
  }).catch(() => {});
  await notifyTelegram(`📞 Voicemail dropped → ${site.businessName} (${site.phone}). Follow-up text sends once it's confirmed delivered.`).catch(() => {});

  // Arm the delivery-gated follow-up text instead of sending it now.
  if (withText) {
    await db.update(forgeSites)
      .set({ vmTextPending: true, vmDroppedAt: sql`now()` })
      .where(eq(forgeSites.id, site.id))
      .catch(() => {});
  }

  return {
    ok: true,
    dropped: true,
    texted: false,
    message: `Voicemail dropped to ${site.businessName}${withText ? " — follow-up text will send once it's confirmed delivered (or ~8-min fallback)." : "."}`,
  };
}

/**
 * Send the armed follow-up text for a lead whose voicemail drop is resolved. Called by the Drop
 * Cowboy delivery webhook (`delivered` → the "did you get my voicemail?" text; `failed` → a non-VM
 * text) and by the fallback sweep (`fallback` → non-VM, when no webhook ever arrived). The pending
 * flag is cleared ATOMICALLY first so the webhook and the fallback cron can never both send.
 */
export async function sendPendingVmText(
  siteId: number,
  reason: "delivered" | "failed" | "fallback",
): Promise<boolean> {
  const [site] = await db
    .select({ id: forgeSites.id, businessName: forgeSites.businessName, phone: forgeSites.phone, liveUrl: forgeSites.liveUrl, slug: forgeSites.slug })
    .from(forgeSites)
    .where(eq(forgeSites.id, siteId))
    .limit(1);
  if (!site || !site.phone) return false;

  // Claim it: only the caller that flips pending true→false actually sends (race-safe).
  const claimed = await db
    .update(forgeSites)
    .set({ vmTextPending: false })
    .where(and(eq(forgeSites.id, siteId), eq(forgeSites.vmTextPending, true)))
    .returning({ id: forgeSites.id });
  if (claimed.length === 0) return false;

  const msg = reason === "delivered"
    ? composeVoicemailFollowupSms({ liveUrl: site.liveUrl, slug: site.slug })
    : composeVoicemailFallbackSms({ liveUrl: site.liveUrl, slug: site.slug });

  const res = await sendSms(site.phone, msg);
  const ok = "ok" in res && res.ok === true;
  if (ok) {
    await db.insert(activityLog).values({
      actor: "agent",
      eventType: "sms_outreach_sent",
      summary: `📤 Follow-up text to ${site.businessName} (${reason === "delivered" ? "voicemail delivered" : reason === "failed" ? "voicemail failed" : "no delivery confirmation"})`,
      metadata: { detail: { siteId, note: msg, to: site.phone, channel: "text", via: "voicemail", trigger: reason } },
    }).catch(() => {});
    await notifyTelegram(`📤 Follow-up text → ${site.businessName} (${reason}):\n${msg}`).catch(() => {});
  } else {
    await notifyTelegram(`⚠️ Follow-up text to ${site.businessName} failed to send (${reason}).`).catch(() => {});
  }
  return ok;
}
