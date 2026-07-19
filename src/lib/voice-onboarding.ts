/**
 * VOICE-LED RECEPTIONIST ONBOARDING — the security boundary, in one file.
 *
 * Ivy interviews a paying customer over the phone and fills in their receptionist config, instead
 * of making them type prose into /portal/receptionist. The onboarding call doubles as the demo:
 * someone buying an AI receptionist experiences one doing intake on them.
 *
 * THE THREAT THIS FILE EXISTS TO STOP.
 * Account numbers are sequential from 100001 (scripts/db/add-account-numbers.mjs) and
 * /api/voice/verify accepts any /^\d{4,}$/. So an account number IDENTIFIES a caller; it cannot
 * AUTHORIZE one. If reading a guessable number aloud were enough to rewrite receptionist config,
 * an attacker could dial in, claim to be a competitor, and repoint that business's emergency calls
 * at their own phone. That is a business takeover, not a data leak.
 *
 * So: identification (account number) and authorization (a one-time code) are separate steps, and
 * THE CODE IS ONLY EVER SENT TO A DESTINATION ALREADY ON FILE — never to a number or address the
 * caller says out loud. A caller-supplied destination would make the whole exercise theatre.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { randomInt } from "node:crypto";

import { db, forgeSites, contacts, voiceOnboarding } from "@/db";
import { canReceiveSms, sendSms, normalizePhone } from "@/lib/sms";
import { sendNotificationEmail } from "@/lib/email";

/** How long a code is good for. Short enough to be useless later, long enough for slow SMS. */
const CODE_TTL_MIN = 10;
/** Wrong guesses before the challenge is dead. 6 digits × 5 tries = 1 in 200,000. */
const MAX_ATTEMPTS = 5;

export type OnboardingTarget = {
  siteId: number;
  userId: string | null;
  businessName: string;
  /** Which plan they're on — the interview is gated on this. */
  plan: string | null;
  subscriptionStatus: string | null;
  oneTimePaid: boolean;
};

/** Plans that include the receptionist. Legacy keys stay here so existing subscribers still pass. */
const VOICE_PLANS = new Set(["answer", "respond", "recover", "voice", "complete"]);

export function planIncludesReceptionist(plan: string | null | undefined): boolean {
  return !!plan && VOICE_PLANS.has(plan);
}

/**
 * Resolve a spoken account number to the business behind it.
 *
 * Returns null for anything unrecognised — the CALLER must not be able to tell "no such account"
 * apart from "not eligible", or the endpoint becomes an oracle for enumerating customers. The
 * route is responsible for saying the same thing in both cases.
 */
export async function targetByAccountNumber(accountNumber: string): Promise<OnboardingTarget | null> {
  const digits = (accountNumber || "").replace(/\D/g, "");
  if (digits.length < 5) return null;

  const [row] = await db
    .select({
      siteId: forgeSites.id,
      userId: forgeSites.claimedByUserId,
      businessName: forgeSites.businessName,
      plan: forgeSites.plan,
      subscriptionStatus: forgeSites.subscriptionStatus,
      oneTimePaid: forgeSites.oneTimePaid,
    })
    .from(forgeSites)
    .where(
      and(
        sql`${forgeSites.claimedByUserId} IN (SELECT id FROM better_auth."user" WHERE account_number = ${digits})`,
        sql`${forgeSites.status} <> 'deleted'`,
      ),
    )
    .limit(1);

  if (!row) return null;
  return { ...row, oneTimePaid: row.oneTimePaid === true };
}

/**
 * Where a one-time code may be sent. ON-FILE DESTINATIONS ONLY.
 *
 * SMS to the business phone is preferred: on a phone call "check your texts" is far less friction
 * than "go find your email", and controlling the business's published number is exactly the
 * capability at stake when the thing being configured is where that business's calls go.
 *
 * Email is the fallback because plenty of these numbers are landlines that cannot receive SMS.
 * It is a strong fallback: better-auth enforces email verification at signup (src/lib/auth.ts),
 * so the address is already proven.
 */
export async function onFileDestination(
  t: OnboardingTarget,
  prefer: "sms" | "email" | null = null,
): Promise<{ channel: "sms" | "email"; to: string; spoken: string } | null> {
  const [c] = await db
    .select({ phone: contacts.phone, email: contacts.email })
    .from(contacts)
    .where(eq(contacts.siteId, t.siteId))
    .limit(1);

  const [site] = await db
    .select({ phone: forgeSites.phone, email: forgeSites.email })
    .from(forgeSites)
    .where(eq(forgeSites.id, t.siteId))
    .limit(1);

  const phone = normalizePhone(c?.phone) || normalizePhone(site?.phone);
  const email = (c?.email || site?.email || "").trim();
  const emailDest = email.includes("@")
    ? {
        channel: "email" as const,
        to: email,
        spoken: (() => {
          const [user, domain] = email.split("@");
          return `the email ${user.slice(0, 2)}${"•".repeat(Math.max(1, user.length - 2))}@${domain}`;
        })(),
      }
    : null;

  // The caller asked us to email it instead (their number is a desk phone, or the text never came).
  // Still an on-file address — `prefer` only chooses BETWEEN destinations we already hold.
  if (prefer === "email" && emailDest) return emailDest;

  if (phone) {
    // Twilio accepts a send to a landline and reports success; delivery fails later, silently. For
    // a one-time code that means the caller waits on the line for a text that will never arrive, so
    // check the line type first and route to email when we know it can't receive.
    const smsCapable = await canReceiveSms(phone);
    if (smsCapable === false && emailDest) {
      console.warn(`[voice-onboarding] site ${t.siteId}: ${phone.slice(-4)} is a landline — using email`);
      return emailDest;
    }
    // smsCapable === null means Lookup couldn't tell us. Try SMS anyway; refusing on an
    // inconclusive lookup would break onboarding for everyone during a Twilio blip.
    return { channel: "sms", to: phone, spoken: `the phone ending ${phone.slice(-4)}` };
  }

  return emailDest;
}

/** Did the last challenge for this site go out by SMS and never get verified? */
export async function lastChallengeWentUnansweredBySms(siteId: number): Promise<boolean> {
  const [row] = await db
    .select({ channel: voiceOnboarding.channel, status: voiceOnboarding.status })
    .from(voiceOnboarding)
    .where(eq(voiceOnboarding.siteId, siteId))
    .orderBy(desc(voiceOnboarding.createdAt))
    .limit(1);
  return row?.channel === "sms" && row.status !== "verified";
}

/** Challenges a single site may start per hour, before we stop sending. */
const MAX_CHALLENGES_PER_HOUR = 3;

/**
 * Has this site already been sent too many codes recently?
 *
 * Without this, locking a challenge after 5 wrong guesses achieves little: the caller just starts
 * a new one. The attacker still cannot READ any code (they all go to the owner), so this is not a
 * takeover path — but an enumerated account number could be used to text its owner over and over,
 * which is harassment and bills us per message. Throttle on the site, since that is the thing being
 * targeted; a caller can trivially change their own call id.
 */
export async function challengeThrottled(siteId: number): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(voiceOnboarding)
    .where(
      and(
        eq(voiceOnboarding.siteId, siteId),
        sql`${voiceOnboarding.createdAt} > now() - interval '1 hour'`,
      ),
    );
  return (row?.n ?? 0) >= MAX_CHALLENGES_PER_HOUR;
}

/**
 * Issue a challenge. Any previous pending challenge for this site is superseded, so a second
 * attempt can never race the first (and the partial unique index enforces it at the DB level).
 */
export async function startChallenge(
  t: OnboardingTarget,
  dest: { channel: "sms" | "email"; to: string },
  retellCallId?: string | null,
): Promise<{ ok: boolean }> {
  const code = String(randomInt(100000, 1000000)); // uniform 6 digits; Math.random is not acceptable here

  await db
    .update(voiceOnboarding)
    .set({ status: "expired", updatedAt: new Date().toISOString() })
    .where(and(eq(voiceOnboarding.siteId, t.siteId), eq(voiceOnboarding.status, "pending")));

  await db.insert(voiceOnboarding).values({
    siteId: t.siteId,
    userId: t.userId,
    code,
    sentTo: dest.to,
    channel: dest.channel,
    status: "pending",
    attempts: 0,
    expiresAt: new Date(Date.now() + CODE_TTL_MIN * 60_000).toISOString(),
    retellCallId: retellCallId ?? null,
  });

  const body =
    `ThinkBigJoe: your setup code is ${code}. Read it to the assistant on the call. ` +
    `It expires in ${CODE_TTL_MIN} minutes. If you're not on a call with us, ignore this — ` +
    `and let us know, because someone else tried to set up your receptionist.`;

  try {
    if (dest.channel === "sms") {
      const res = await sendSms(dest.to, body);
      return { ok: "ok" in res && res.ok === true };
    }
    await sendNotificationEmail({
      to: dest.to,
      subject: `Your ThinkBigJoe setup code: ${code}`,
      heading: `Your setup code is ${code}`,
      message: body,
    });
    return { ok: true };
  } catch (err) {
    console.error("[voice-onboarding] failed to send code:", err);
    return { ok: false };
  }
}

export type VerifyOutcome =
  | { ok: true; siteId: number }
  | { ok: false; reason: "no_challenge" | "expired" | "locked" | "wrong"; attemptsLeft?: number };

/**
 * Check a spoken code.
 *
 * THE INCREMENT AND THE CAP HAPPEN IN ONE SQL STATEMENT, AND THAT IS LOad-BEARING.
 *
 * An earlier version did SELECT → `attempts + 1` in JS → UPDATE. Concurrent requests all read the
 * same value and all wrote the same value, so N parallel guesses cost ONE attempt. Five batches of
 * 200k pipelined requests then cover the whole 6-digit keyspace inside the 10-minute TTL while the
 * counter reaches 5 — the one-time code, which is the entire authorization factor, defeated by
 * concurrency alone without ever seeing it. Postgres serialises the row update, so `attempts =
 * attempts + 1 ... WHERE attempts < MAX` makes every concurrent guess pay for itself.
 *
 * On success the session is bound to `callId`, so a verification earned on one call cannot
 * authorize writes from another. See isVerifiedForCall.
 */
export async function verifyChallenge(
  siteId: number,
  spoken: string,
  callId: string | null,
): Promise<VerifyOutcome> {
  const digits = (spoken || "").replace(/\D/g, "");

  // Atomically claim one attempt. Zero rows back means: no pending challenge, it expired, or the
  // cap is already spent — all indistinguishable to the caller by design.
  const claimed = await db.execute(sql`
    UPDATE voice_onboarding
       SET attempts = attempts + 1,
           status = CASE WHEN attempts + 1 >= ${MAX_ATTEMPTS} THEN 'locked' ELSE status END,
           updated_at = now()
     WHERE id = (
       SELECT id FROM voice_onboarding
        WHERE site_id = ${siteId} AND status = 'pending'
        ORDER BY created_at DESC LIMIT 1
     )
       AND attempts < ${MAX_ATTEMPTS}
       AND expires_at > now()
    RETURNING id, code, attempts
  `);

  const row = (claimed as unknown as { rows: Array<{ id: number; code: string; attempts: number }> }).rows?.[0];
  if (!row) {
    // Distinguish only for the SPOKEN copy — none of this changes what an attacker can learn,
    // because reaching here always means "you get nothing".
    const [latest] = await db
      .select({ status: voiceOnboarding.status, expiresAt: voiceOnboarding.expiresAt })
      .from(voiceOnboarding)
      .where(eq(voiceOnboarding.siteId, siteId))
      .orderBy(desc(voiceOnboarding.createdAt))
      .limit(1);
    if (!latest) return { ok: false, reason: "no_challenge" };
    if (latest.status === "locked") return { ok: false, reason: "locked" };
    if (latest.status === "pending" && new Date(latest.expiresAt).getTime() < Date.now()) {
      return { ok: false, reason: "expired" };
    }
    return { ok: false, reason: "no_challenge" };
  }

  if (digits !== row.code) {
    const left = MAX_ATTEMPTS - row.attempts;
    return left <= 0 ? { ok: false, reason: "locked" } : { ok: false, reason: "wrong", attemptsLeft: left };
  }

  await db
    .update(voiceOnboarding)
    .set({ status: "verified", verifiedAt: new Date().toISOString(), retellCallId: callId })
    .where(eq(voiceOnboarding.id, row.id));
  return { ok: true, siteId };
}

/** A verified session only lives as long as a call plausibly does. */
const SESSION_TTL_MS = 30 * 60_000;

/**
 * Is THIS CALL authorized to write config for this site?
 *
 * The binding to `callId` is the point. Keying on siteId alone meant any request naming a site that
 * someone else had just verified would be authorized — and `site_id` arrives as an LLM-filled tool
 * argument, so it is fully caller-controlled. Site ids are small sequential integers, so an attacker
 * could sweep 1..2000 every minute and land inside any legitimate customer's verified window.
 *
 * The challenge row already carried retell_call_id and simply wasn't being read. It is now.
 */
export async function isVerifiedForCall(siteId: number, callId: string | null): Promise<boolean> {
  if (!callId) return false; // no call identity, no authorization
  const [row] = await db
    .select({ verifiedAt: voiceOnboarding.verifiedAt })
    .from(voiceOnboarding)
    .where(
      and(
        eq(voiceOnboarding.siteId, siteId),
        eq(voiceOnboarding.status, "verified"),
        eq(voiceOnboarding.retellCallId, callId),
      ),
    )
    .orderBy(desc(voiceOnboarding.createdAt))
    .limit(1);
  if (!row?.verifiedAt) return false;
  return Date.now() - new Date(row.verifiedAt).getTime() < SESSION_TTL_MS;
}

/**
 * How many DISTINCT businesses has this one call already challenged?
 *
 * challengeThrottled() caps per SITE — i.e. per victim — which imposes no cost at all on sweeping
 * DIFFERENT account numbers, since every account is its own bucket. Each eligible hit returns
 * business_name + site_id and fires a real SMS, so an unthrottled sweep is both a customer-list
 * oracle and owner-facing text-bombing on our bill. Counting rows already written by this call
 * makes the sweep pay per discovery.
 */
export async function callChallengeCount(callId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(distinct site_id)::int` })
    .from(voiceOnboarding)
    .where(
      and(
        eq(voiceOnboarding.retellCallId, callId),
        sql`${voiceOnboarding.createdAt} > now() - interval '1 hour'`,
      ),
    );
  return row?.n ?? 0;
}

/** Businesses one call may look up before we stop answering. Real setup needs exactly one. */
export const MAX_SITES_PER_CALL = 2;
