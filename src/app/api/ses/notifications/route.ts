import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { sql } from "drizzle-orm";

import { db, newsletterSends } from "@/db";
import { suppress } from "@/lib/suppressions";

export const dynamic = "force-dynamic";

/**
 * SES → SNS delivery-event webhook. This is what keeps the suppression list current and is why SES
 * production access will pass: bounces + complaints land here and are suppressed automatically.
 *
 * Handles three SNS message types:
 *  - SubscriptionConfirmation — auto-confirm (one-time, when Joe wires the SNS topic to this URL).
 *  - Notification (Bounce, permanent) — suppress the address; mark the matching send row bounced.
 *  - Notification (Complaint) — suppress the address; mark the row complained.
 *
 * SNS message signatures are verified so a forged POST can't inject suppressions. See
 * docs/EMAIL_SCALE.md.
 */

// The fields SNS signs, in order, per message type (SignatureVersion 1).
const SIGNED_KEYS: Record<string, string[]> = {
  Notification: ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"],
  SubscriptionConfirmation: ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"],
  UnsubscribeConfirmation: ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"],
};

type SnsEnvelope = Record<string, string> & { Type: string; SigningCertURL?: string; Signature?: string };

/** Only fetch certs from amazonaws SNS hosts — never an attacker-supplied URL. */
function certUrlOk(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && /(^|\.)amazonaws\.com$/.test(u.hostname) && u.pathname.endsWith(".pem");
  } catch {
    return false;
  }
}

const certCache = new Map<string, string>();
async function fetchCert(url: string): Promise<string | null> {
  if (certCache.has(url)) return certCache.get(url)!;
  const res = await fetch(url);
  if (!res.ok) return null;
  const pem = await res.text();
  certCache.set(url, pem);
  return pem;
}

async function verifySignature(msg: SnsEnvelope): Promise<boolean> {
  const keys = SIGNED_KEYS[msg.Type];
  if (!keys || !msg.Signature || !msg.SigningCertURL || !certUrlOk(msg.SigningCertURL)) return false;
  const stringToSign = keys
    .filter((k) => msg[k] !== undefined)
    .map((k) => `${k}\n${msg[k]}\n`)
    .join("");
  const pem = await fetchCert(msg.SigningCertURL);
  if (!pem) return false;
  try {
    const v = crypto.createVerify("RSA-SHA1"); // SNS SignatureVersion 1
    v.update(stringToSign, "utf8");
    return v.verify(pem, msg.Signature, "base64");
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  let env: SnsEnvelope;
  try {
    env = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  if (!(await verifySignature(env))) {
    return NextResponse.json({ error: "bad signature" }, { status: 403 });
  }

  // One-time: confirm the SNS subscription so events start flowing to this endpoint.
  if (env.Type === "SubscriptionConfirmation" && env.SubscribeURL) {
    await fetch(env.SubscribeURL).catch(() => {});
    return NextResponse.json({ ok: true, confirmed: true });
  }

  if (env.Type !== "Notification") return NextResponse.json({ ok: true });

  let note: Record<string, unknown>;
  try {
    note = JSON.parse(env.Message);
  } catch {
    return NextResponse.json({ ok: true }); // not an SES event we parse
  }

  const type = note.notificationType || note.eventType;
  const mail = (note.mail || {}) as { messageId?: string };

  const markRow = (status: string) =>
    mail.messageId
      ? db.update(newsletterSends).set({ status, updatedAt: new Date().toISOString() })
          .where(sql`message_id = ${mail.messageId}`).catch(() => {})
      : Promise.resolve();

  if (type === "Bounce") {
    const b = (note.bounce || {}) as { bounceType?: string; bouncedRecipients?: Array<{ emailAddress?: string }> };
    // Only PERMANENT bounces suppress; transient ones may recover.
    if (b.bounceType === "Permanent") {
      for (const r of b.bouncedRecipients || []) {
        if (r.emailAddress) await suppress(r.emailAddress, "bounce", "SES permanent bounce");
      }
      await markRow("bounced");
    }
  } else if (type === "Complaint") {
    const c = (note.complaint || {}) as { complainedRecipients?: Array<{ emailAddress?: string }> };
    for (const r of c.complainedRecipients || []) {
      if (r.emailAddress) await suppress(r.emailAddress, "complaint", "SES complaint");
    }
    await markRow("complained");
  }

  return NextResponse.json({ ok: true });
}
