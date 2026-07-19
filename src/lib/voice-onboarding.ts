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
import { sendSms, normalizePhone } from "@/lib/sms";
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
  if (phone) {
    // Spoken form names only the last four: enough for the real owner to recognise which handset,
    // useless to someone who guessed the account number and is fishing for the full number.
    return { channel: "sms", to: phone, spoken: `the phone ending ${phone.slice(-4)}` };
  }

  const email = (c?.email || site?.email || "").trim();
  if (email && email.includes("@")) {
    const [user, domain] = email.split("@");
    const masked = `${user.slice(0, 2)}${"•".repeat(Math.max(1, user.length - 2))}@${domain}`;
    return { channel: "email", to: email, spoken: `the email ${masked}` };
  }

  return null;
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
 * Deliberately NOT constant-time compared: the code is single-use, rate-limited to 5 attempts, and
 * expires in 10 minutes, so a timing oracle buys an attacker nothing. Attempts are counted BEFORE
 * the comparison so a crash mid-check can't be used to get free guesses.
 */
export async function verifyChallenge(siteId: number, spoken: string): Promise<VerifyOutcome> {
  const digits = (spoken || "").replace(/\D/g, "");

  const [row] = await db
    .select()
    .from(voiceOnboarding)
    .where(and(eq(voiceOnboarding.siteId, siteId), eq(voiceOnboarding.status, "pending")))
    .orderBy(desc(voiceOnboarding.createdAt))
    .limit(1);

  if (!row) return { ok: false, reason: "no_challenge" };

  if (new Date(row.expiresAt).getTime() < Date.now()) {
    await db.update(voiceOnboarding).set({ status: "expired" }).where(eq(voiceOnboarding.id, row.id));
    return { ok: false, reason: "expired" };
  }

  const attempts = row.attempts + 1;
  if (attempts > MAX_ATTEMPTS) {
    await db.update(voiceOnboarding).set({ status: "locked" }).where(eq(voiceOnboarding.id, row.id));
    return { ok: false, reason: "locked" };
  }
  await db.update(voiceOnboarding).set({ attempts }).where(eq(voiceOnboarding.id, row.id));

  if (digits !== row.code) {
    if (attempts >= MAX_ATTEMPTS) {
      await db.update(voiceOnboarding).set({ status: "locked" }).where(eq(voiceOnboarding.id, row.id));
      return { ok: false, reason: "locked" };
    }
    return { ok: false, reason: "wrong", attemptsLeft: MAX_ATTEMPTS - attempts };
  }

  await db
    .update(voiceOnboarding)
    .set({ status: "verified", verifiedAt: new Date().toISOString() })
    .where(eq(voiceOnboarding.id, row.id));
  return { ok: true, siteId };
}

/** Is there a live verified session for this site? Every write path must check this first. */
export async function isVerified(siteId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: voiceOnboarding.id, verifiedAt: voiceOnboarding.verifiedAt })
    .from(voiceOnboarding)
    .where(and(eq(voiceOnboarding.siteId, siteId), eq(voiceOnboarding.status, "verified")))
    .orderBy(desc(voiceOnboarding.createdAt))
    .limit(1);
  if (!row?.verifiedAt) return false;
  // A verified session is good for the length of a call, not forever.
  return Date.now() - new Date(row.verifiedAt).getTime() < 60 * 60_000;
}
