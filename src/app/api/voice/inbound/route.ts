import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { tenantByNumber } from "@/lib/voice-tenant";
import { buildDynamicVariables, fallbackVariables } from "@/lib/voice-vars";

export const dynamic = "force-dynamic";
/**
 * Hard ceiling well under Retell's 10s inbound budget. Without it the platform default could let a
 * hung Neon fetch outlive the caller's patience and eat all 3 retries. See LOOKUP_DEADLINE_MS.
 */
export const maxDuration = 10;

/**
 * Retell INBOUND CALL WEBHOOK — the tenant-resolution point of the whole voice system.
 *
 * Retell POSTs here the moment a call arrives, BEFORE the call object exists, and waits for us to
 * say who this business is. We answer with per-call dynamic variables, which is what lets one
 * shared receptionist agent speak as any customer.
 *
 * Tenancy comes from the number that was DIALLED (`call_inbound.to_number`) and nothing else. It is
 * never a tool argument and never the caller's number — otherwise a caller could talk the agent
 * into acting for a different business.
 *
 * THREE RULES, all of which exist because a real person is on the line while this runs:
 *
 * 1. NEVER 5xx, never throw. Retell's budget here is 10 seconds with 3 retries; a non-2xx means the
 *    caller holds through retries and hears dead air. Any failure returns fallback variables with a
 *    200 so the agent still answers politely and takes a message.
 * 2. ONE indexed query, nothing else, and it must finish inside LOOKUP_DEADLINE_MS. No forge calls,
 *    no agent-org calls, no recording fetches.
 * 3. Never leak. Every outcome — unknown number, unauthorized, timeout, crash — returns the SAME
 *    bytes, so this can't be used to enumerate which businesses we serve or how fast we answer.
 *
 * AUTH: gated on a secret WE choose, passed as `?k=` in the URL we register with Retell as the
 * number's `inbound_webhook_url`. Retell POSTs to exactly the URL we configure, so a query secret is
 * a credential we fully control — unlike `x-retell-signature`, whose HMAC construction we could not
 * confirm from the docs. Presence of that header is NOT authentication and is never treated as such.
 *
 * This matters more here than it looks: buildDynamicVariables() returns escalation_phone, which is
 * the owner's personal cell. Unauthenticated, this route was an open lookup API over the customer
 * base — POST a guessed number, get a small business owner's mobile.
 */

/** Deadline for the tenant lookup. A timeout is treated exactly like a miss — the caller still
 *  gets a polite generic greeting instead of dead air. */
const LOOKUP_DEADLINE_MS = 2500;

/** Warn once per process, not once per call — a hot line would otherwise flood the log. */
let warnedMissingKey = false;

/**
 * Constant-time compare of `?k=` against VOICE_WEBHOOK_KEY.
 *
 * Fail-OPEN when the env var is unset, deliberately: a half-configured deploy must drop zero live
 * phone calls. Losing a plumber's job to a missing env var is worse than the window this leaves,
 * and the loud warning is what closes that window.
 */
function inboundAuthed(req: Request): boolean {
  const expected = process.env.VOICE_WEBHOOK_KEY;
  if (!expected) {
    if (!warnedMissingKey) {
      warnedMissingKey = true;
      console.warn(
        "[voice/inbound] VOICE_WEBHOOK_KEY is not set — inbound webhook is UNAUTHENTICATED and will " +
          "hand tenant config (including escalation_phone) to any caller. Set it and re-register the " +
          "number's inbound_webhook_url with ?k=<key>.",
      );
    }
    return true;
  }

  const got = new URL(req.url).searchParams.get("k") ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  // timingSafeEqual THROWS on a length mismatch, so length must be checked first. Length itself is
  // not secret enough to matter here.
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The dialled number, per the inbound-webhook contract: nested under `call_inbound`. */
function dialledNumber(body: unknown): string | undefined {
  const inbound = ((body ?? {}) as Record<string, unknown>).call_inbound as
    | Record<string, unknown>
    | undefined;
  // Tolerate the flat/`call` shapes too — cheap, and the inbound payload is the odd one out among
  // Retell's events (voice-tenant.ts's calledNumber() only knows the `call`/flat forms).
  const b = (body ?? {}) as Record<string, unknown>;
  const call = b.call as Record<string, unknown> | undefined;
  const raw = inbound?.to_number ?? call?.to_number ?? b.to_number;
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

/** The one response shape this route ever emits for a non-tenant outcome. Byte-identical across
 *  unauthorized / unknown number / timeout / crash — anything else makes the route an oracle. */
function genericResponse() {
  return NextResponse.json({
    call_inbound: {
      dynamic_variables: fallbackVariables(),
      metadata: { site_id: "", slug: "" },
    },
  });
}

type LookupOutcome =
  | { kind: "tenant"; tenant: Awaited<ReturnType<typeof tenantByNumber>> }
  | { kind: "miss" }
  | { kind: "timeout" };

/**
 * Race the lookup against the deadline. The Neon HTTP driver's fetch has no default timeout, so a
 * hung query would otherwise burn Retell's whole budget and then be retried 3x — three hung queries
 * per call. We can't cancel the query, but we can stop waiting on it.
 */
async function lookupWithDeadline(dialled: string): Promise<LookupOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<LookupOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "timeout" }), LOOKUP_DEADLINE_MS);
  });
  try {
    return await Promise.race([
      tenantByNumber(dialled).then(
        (tenant): LookupOutcome => (tenant ? { kind: "tenant", tenant } : { kind: "miss" }),
      ),
      deadline,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function POST(req: Request) {
  let dialled: string | undefined;

  try {
    if (!inboundAuthed(req)) {
      // Same 200 + same body as every other outcome. A 401 here would both tell a prober that the
      // endpoint exists and, if we ever got the key wrong, drop real calls.
      console.warn("[voice/inbound] rejected: bad or missing ?k=");
      return genericResponse();
    }

    const body: unknown = await req.json().catch(() => ({}));
    dialled = dialledNumber(body);

    // tenantByNumber() normalizes to E.164 and only resolves active/provisioning lines, so a
    // cancelled customer's number stops answering as them rather than answering as a stranger.
    const outcome: LookupOutcome = dialled
      ? await lookupWithDeadline(dialled)
      : { kind: "miss" };

    if (outcome.kind === "timeout") {
      // Logged distinctly on purpose: a slow DB must not masquerade as "we don't serve that number"
      // in the logs, or a database problem reads as a provisioning problem for weeks.
      console.error(
        `[voice/inbound] TIMEOUT after ${LOOKUP_DEADLINE_MS}ms resolving dialled=${dialled ?? "unknown"} — answering with fallback`,
      );
      return genericResponse();
    }

    if (outcome.kind === "miss" || !outcome.tenant) {
      console.log(`[voice/inbound] dialled=${dialled ?? "unknown"} tenant=none`);
      return genericResponse();
    }

    const tenant = outcome.tenant;
    console.log(`[voice/inbound] dialled=${dialled ?? "unknown"} tenant=${tenant.slug}#${tenant.siteId}`);

    return NextResponse.json({
      call_inbound: {
        // NOTE the key: the inbound webhook response uses `dynamic_variables`. The long
        // `retell_llm_dynamic_variables` name belongs to the Create Phone Call API and the echoed
        // call object — using it here fails silently, and the agent reads raw {{braces}} aloud.
        dynamic_variables: buildDynamicVariables(tenant),
        // Internal ids go in metadata, not variables: metadata is stored on the call and echoed
        // back on call_ended/call_analyzed, and the LLM never sees it.
        metadata: { site_id: String(tenant.siteId), slug: tenant.slug },
      },
    });
  } catch (err) {
    // Deliberately a 200. See rule 1 above — a 500 costs us the call.
    console.error(`[voice/inbound] failed dialled=${dialled ?? "unknown"}:`, err);
    return genericResponse();
  }
}

/** Smoke check. Exposes nothing about any tenant. */
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "voice/inbound" });
}
