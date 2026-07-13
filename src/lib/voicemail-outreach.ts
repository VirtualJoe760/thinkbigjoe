import { db, activityLog } from "@/db";
import { dropVoicemail, dropCowboyCallbackUrl } from "@/lib/dropcowboy";
import { sendSms } from "@/lib/sms";
import { composeVoicemailFollowupSms } from "@/lib/forge-outreach";
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

/**
 * The "call, then follow up with a text" first-touch: drop a ringless voicemail, log it, and
 * (optionally) send the first-touch SMS with the site link right after so it's waiting when they
 * check. Shared by the lead-page button, the batch cron, and the MCP tool. `dry` previews without
 * sending. Logs `voicemail_dropped` (+ `sms_outreach_sent`) so nothing double-sends.
 */
export async function dropToSite(
  site: VmSite,
  opts: { withText?: boolean; dry?: boolean } = {},
): Promise<VmDropOutcome> {
  const withText = opts.withText ?? true;
  if (!site.phone) return { ok: false, dropped: false, texted: false, message: "No phone number on this lead." };

  if (opts.dry) {
    return { ok: true, dropped: false, texted: false, message: `DRY — would drop VM${withText ? " + text" : ""} to ${site.businessName}` };
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
  await notifyTelegram(`📞 Voicemail dropped → ${site.businessName} (${site.phone}).`).catch(() => {});

  let texted = false;
  if (withText) {
    const msg = composeVoicemailFollowupSms({ liveUrl: site.liveUrl, slug: site.slug });
    const res = await sendSms(site.phone, msg);
    if ("ok" in res && res.ok) {
      texted = true;
      await db.insert(activityLog).values({
        actor: "agent",
        eventType: "sms_outreach_sent",
        summary: `📤 First-touch text to ${site.businessName} (after voicemail)`,
        metadata: { detail: { siteId: site.id, note: msg, to: site.phone, channel: "text", via: "outreach" } },
      }).catch(() => {});
      await notifyTelegram(`📤 Follow-up text → ${site.businessName}:\n${msg}`).catch(() => {});
    }
  }

  return {
    ok: true,
    dropped: true,
    texted,
    message: `Voicemail dropped to ${site.businessName}${texted ? " + follow-up text sent" : ""}.`,
  };
}
