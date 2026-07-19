/**
 * Retell CALL-LIFECYCLE webhook — the only thing that makes a call survive the call.
 *
 * Retell's retention is not our database: if we don't write the row here, the portal has nothing to
 * show tomorrow morning and the product is invisible on day 2. So this handler is deliberately
 * paranoid about two things:
 *
 *  1. **5xx exactly when a retry could help.** Retell retries failed deliveries, so the status code
 *     is a signal, not decoration. A TRANSIENT failure (the DB write) returns 500 so the retry
 *     fires and the call survives. Everything a retry can never fix — unparseable body, missing
 *     call_id, unknown tenant, an event we skip — returns 200 so Retell stops.
 *  2. **Enrich, never clobber.** /api/voice/message writes a row MID-CALL with the good stuff the
 *     caller actually said (name, callback number, problem, urgency). Those fields are absent from
 *     the Retell payload, so a naive upsert would overwrite them with nulls and destroy the lead.
 *     Every column the live tools own is written with COALESCE(existing, new).
 *
 * Events (names per docs.retellai.com/features/webhook):
 *   call_started  — open the row early so an abandoned call still shows up
 *   call_ended    — duration, transcript, recording, disposition
 *   call_analyzed — fires LATER than call_ended and is the ONLY event carrying call_analysis
 *                   (summary, sentiment, in_voicemail). Building the UI off call_ended alone
 *                   leaves every summary permanently null.
 *
 * Tenancy comes from `call.to_number` (the number DIALLED), never from the payload's agent id or a
 * tool argument — see src/lib/voice-tenant.ts for why.
 */
import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";

import { calls, db } from "@/db";
import { normalizePhone } from "@/lib/sms";
import { tenantByNumber } from "@/lib/voice-tenant";

export const dynamic = "force-dynamic";

/** ms-since-epoch → ISO string. Retell sends MILLISECONDS; treating them as seconds lands in 1970. */
function isoFromMs(v: unknown): string | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? new Date(v).toISOString() : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Retell has no `disposition` field — it's derived from how the call ended.
 * Only ever used to FILL a null: if a tool already recorded `message` or `booked`, that is the
 * truth about what happened and this guess must not overwrite it.
 */
function deriveDisposition(call: Record<string, unknown>): string | null {
  const analysis = (call.call_analysis ?? {}) as Record<string, unknown>;
  if (analysis.in_voicemail === true) return "unknown";

  const reason = str(call.disconnection_reason);
  if (reason === "call_transfer") return "transferred";
  // A caller who hangs up in seconds without reaching a tool is almost always a robocall/misdial.
  const durationMs = typeof call.duration_ms === "number" ? call.duration_ms : null;
  if (reason === "user_hangup" && durationMs !== null && durationMs < 10_000) return "spam";
  if (str(call.call_status) === "error" || reason === "dial_failed") return "unknown";
  return null; // no confident read — leave null rather than assert something wrong in the portal
}

/** Warn once per process, not once per delivery — a busy line would otherwise flood the log. */
let warnedMissingKey = false;

/**
 * AUTH — a secret WE choose, passed as `?k=` in the URL registered with Retell as the webhook URL.
 * Retell POSTs to exactly the URL we configure, so a query secret is a credential we fully control.
 *
 * What this replaced was a security hole, not a compromise: the old branch returned true for ANY
 * request carrying an `x-retell-signature` header WITHOUT CHECKING ITS VALUE, so `-H
 * 'x-retell-signature: x'` was a valid credential for writing rows into the calls table. Presence of
 * a header is never authentication. The bearer branch it fell through from could not be satisfied by
 * real Retell traffic at all, so that presence check was the only gate in practice.
 *
 * We still don't verify the signature: its HMAC construction isn't documented and the Retell SDK
 * isn't a dependency, so any implementation would be a guess. If it is ever wired up it is a BONUS
 * check on top of `?k=` (and must read the raw body via `req.text()`, not `req.json()`) — never the
 * gate on its own.
 *
 * Fail-OPEN when VOICE_WEBHOOK_KEY is unset, deliberately: a half-configured deploy must not
 * silently discard every customer's call history. The loud warning is what closes that window.
 */
function webhookAuthed(req: Request): boolean {
  const expected = process.env.VOICE_WEBHOOK_KEY;
  if (!expected) {
    if (!warnedMissingKey) {
      warnedMissingKey = true;
      console.warn(
        "[voice/webhook] VOICE_WEBHOOK_KEY is not set — call webhook is UNAUTHENTICATED and anyone " +
          "can write rows into the calls table. Set it and re-register the webhook URL with ?k=<key>.",
      );
    }
    return true;
  }

  const got = new URL(req.url).searchParams.get("k") ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  // timingSafeEqual THROWS on a length mismatch, so length must be checked first.
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The ONE body this route returns for every outcome it reports with a 200.
 *
 * Identical bytes on success, unknown tenant, skipped event and bad payload alike. The previous
 * version echoed `siteId` on success and `{ignored:"unknown number"}` on a miss, which made an
 * endpoint reachable without strong auth into an oracle: POST guessed numbers, learn which ones we
 * serve and their internal ids. Distinguishing detail goes to the console only.
 */
function ok() {
  return NextResponse.json({ ok: true });
}

export async function POST(req: Request) {
  if (!webhookAuthed(req)) {
    // 200, and the same body as everything else — a 401 confirms the endpoint to a prober, and a
    // retry can't fix a wrong key anyway.
    console.warn("[voice/webhook] rejected: bad or missing ?k=");
    return ok();
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // A retry re-sends the same unparseable bytes. 200 so Retell stops.
    console.warn("[voice/webhook] unparseable body");
    return ok();
  }

  const event = str(body.event) ?? "";
  const call = (body.call ?? {}) as Record<string, unknown>;

  if (!["call_started", "call_ended", "call_analyzed"].includes(event)) {
    // transcript_updated fires constantly and transfer_* add nothing we persist. 200 so Retell
    // stops rather than retrying an event we intentionally skip.
    return ok();
  }

  const retellCallId = str(call.call_id);
  if (!retellCallId) {
    // Nothing to key the row on, and a retry carries the same payload. 200.
    console.warn("[voice/webhook] %s with no call.call_id — skipping", event);
    return ok();
  }

  const toNumber = normalizePhone(str(call.to_number) ?? undefined);
  const tenant = await tenantByNumber(toNumber);
  if (!tenant) {
    // Our own TBJ sales line (Ivy) also flows through here and has no voice_lines row, as does any
    // number whose customer was released. Nothing to attribute the call to — drop it quietly.
    // 200: a retry would resolve the same number to the same nothing.
    console.warn("[voice/webhook] %s: no tenant for dialled number %s", event, toNumber ?? "(none)");
    return ok();
  }

  const analysis = (call.call_analysis ?? {}) as Record<string, unknown>;
  const durationMs = typeof call.duration_ms === "number" ? call.duration_ms : null;

  const incoming = {
    fromNumber: normalizePhone(str(call.from_number) ?? undefined) ?? null,
    toNumber: tenant.lineNumber,
    startedAt: isoFromMs(call.start_timestamp),
    endedAt: isoFromMs(call.end_timestamp),
    durationSec: durationMs !== null ? Math.round(durationMs / 1000) : null,
    transcript: str(call.transcript),
    // call_analysis only exists on call_analyzed — null on the other events, which is exactly why
    // every field below is merged rather than assigned.
    summary: str(analysis.call_summary),
    // Retell's recording link expires ~10 minutes after the call. Stored as-is for now because
    // re-hosting needs a blob bucket this slice doesn't own; the portal must treat it as best-effort.
    recordingUrl: str(call.recording_url),
    disposition: deriveDisposition(call),
  };

  let updated: { id: number }[];
  try {
    updated = await db
      .insert(calls)
      .values({ siteId: tenant.siteId, retellCallId, ...incoming })
      .onConflictDoUpdate({
        target: calls.retellCallId,
        // TENANT PREDICATE — not optional. The conflict target is the GLOBAL unique index on
        // retell_call_id, so without this a request naming another customer's call id would update
        // THAT customer's row: one business's caller data overwritten by another's. With it, such a
        // conflict updates zero rows and is logged below.
        setWhere: eq(calls.siteId, tenant.siteId),
        set: {
          // Prefer the newer value, keep the old one when this event didn't carry the field.
          // (call_analyzed arrives without a transcript; call_ended arrives without a summary.)
          fromNumber: sql`coalesce(excluded.from_number, ${calls.fromNumber})`,
          startedAt: sql`coalesce(excluded.started_at, ${calls.startedAt})`,
          endedAt: sql`coalesce(excluded.ended_at, ${calls.endedAt})`,
          durationSec: sql`coalesce(excluded.duration_sec, ${calls.durationSec})`,
          transcript: sql`coalesce(excluded.transcript, ${calls.transcript})`,
          summary: sql`coalesce(excluded.summary, ${calls.summary})`,
          recordingUrl: sql`coalesce(excluded.recording_url, ${calls.recordingUrl})`,
          // Reverse precedence on purpose: what a live tool recorded beats what we infer afterwards.
          disposition: sql`coalesce(${calls.disposition}, excluded.disposition)`,
        },
      })
      .returning({ id: calls.id });
  } catch (err) {
    // 500 ON PURPOSE — this is the one TRANSIENT failure here, and a 500 is how we ask Retell to
    // retry it. The old code answered 200 and justified it with "Retell will re-deliver
    // call_analyzed anyway"; that is false. call_analyzed is a DIFFERENT event, not a redelivery of
    // call_ended — it carries no transcript, so a swallowed call_ended loses the transcript for
    // good. Telling Retell "delivered" when we wrote nothing is how a customer's call history
    // quietly disappears.
    console.error("[voice/webhook] upsert failed for %s:", retellCallId, err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  if (updated.length === 0) {
    // The row exists under a DIFFERENT site_id, so setWhere blocked the update. Either a genuine
    // retell_call_id collision across tenants (shouldn't happen) or someone probing with a call id
    // they don't own. Never a reason to retry — but always a reason to look.
    console.warn(
      "[voice/webhook] %s: upsert affected 0 rows for retell_call_id=%s — existing row belongs to another site (expected site_id=%d)",
      event,
      retellCallId,
      tenant.siteId,
    );
  }

  // Opaque: no event echo, no siteId. Detail is in the logs above.
  return ok();
}
