import Link from "next/link";

import { StatusPill } from "@/components/ui";

/**
 * One call in the customer's history. Server-rendered: the transcript expands via a native
 * <details>, not client JS — it's a bigger tap target than anything we'd hand-roll, works before
 * hydration, and keeps this whole page zero-JS for a contractor on a bad LTE connection.
 */

export type CallView = {
  id: number;
  startedAt: string | null;
  callerName: string | null;
  callbackNumber: string | null;
  fromNumber: string | null;
  urgency: string | null;
  problem: string | null;
  summary: string | null;
  transcript: string | null;
  disposition: string | null;
  isRealLead: boolean | null;
  durationSec: number | null;
  /** Non-null only when the owner's SMS actually sent. Null on a message = they were never told. */
  notifiedAt: string | null;
};

const URGENCY: Record<string, { tone: "danger" | "warning" | "neutral"; label: string }> = {
  emergency: { tone: "danger", label: "Emergency" },
  urgent: { tone: "warning", label: "Urgent" },
  routine: { tone: "neutral", label: "Routine" },
};

// Only the dispositions something in the codebase actually writes. A 'booked' → "Job booked" entry
// lived here while nothing ever wrote disposition='booked', which reads as a broken feature rather
// than as forward-compat. Add it back together with the 'booked' arm of the "Messages taken" metric
// in page.tsx when voice booking starts writing calls.disposition.
const DISPOSITION: Record<string, { tone: "success" | "info" | "neutral"; label: string }> = {
  message: { tone: "info", label: "Message taken" },
  transferred: { tone: "info", label: "Transferred to you" },
  spam: { tone: "neutral", label: "Spam" },
};

/** +14805551234 → (480) 555-1234. Anything we can't parse is shown verbatim rather than hidden. */
function prettyPhone(raw: string): string {
  const d = raw.replace(/\D/g, "");
  const n = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return n.length === 10 ? `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}` : raw;
}

function whenLabel(iso: string | null, timezone: string): string {
  if (!iso) return "Time unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Time unknown";
  const day = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: timezone }).format(d);
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone }).format(d);
  return `${day} · ${time}`;
}

function durationLabel(sec: number | null): string | null {
  if (!sec || sec < 1) return null;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}

export function CallCard({
  call,
  timezone,
  settingsHref,
}: {
  call: CallView;
  timezone: string;
  /** Where to fix the notification number. Optional so the card stays usable outside the portal. */
  settingsHref?: string;
}) {
  // is_real_lead is nullable — only an explicit `false` means the AI judged this a wrong
  // number/robocall. Null (not yet analyzed) must read as a normal call, not as spam.
  const junk = call.isRealLead === false;
  const urgency = call.urgency ? URGENCY[call.urgency] : undefined;
  const disposition = call.disposition ? DISPOSITION[call.disposition] : undefined;
  const number = call.callbackNumber || call.fromNumber;
  const body = call.problem || call.summary;
  const duration = durationLabel(call.durationSec);

  // Only a message we took ON THE OWNER'S BEHALF carries a delivery promise, so only those can
  // fail one. Spam is never texted by design, and a row with nothing taken (transferred, or a
  // call_started stub) has nothing to deliver — flagging either would teach the owner to ignore
  // the flag, which is the one outcome we can't afford here.
  const owedNotification = !junk && call.disposition === "message";
  const notifyFailed = owedNotification && !call.notifiedAt;

  return (
    <li
      className={`rounded-2xl border border-line bg-background p-4 sm:p-5 ${junk ? "opacity-60" : ""}`.trim()}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
          {whenLabel(call.startedAt, timezone)}
        </span>
        {duration && <span className="text-xs text-ink-soft">· {duration}</span>}
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          {junk ? (
            <StatusPill tone="neutral">Spam / wrong number</StatusPill>
          ) : (
            <>
              {urgency && <StatusPill tone={urgency.tone}>{urgency.label}</StatusPill>}
              {disposition && <StatusPill tone={disposition.tone}>{disposition.label}</StatusPill>}
              {notifyFailed && <StatusPill tone="warning">Not texted to you</StatusPill>}
            </>
          )}
        </span>
      </div>

      <p className="mt-2 text-lg font-bold tracking-tight">
        {call.callerName || (junk ? "No caller name" : "Caller didn’t give a name")}
      </p>

      {body && <p className="mt-1 leading-relaxed text-ink-soft">{body}</p>}

      {/* Sits above the call-back button on purpose: this is the one card where the owner is
          reading the message for the FIRST time, so they need to know that before they decide how
          urgently to act — and the fix (a bad notification number) is one tap away. */}
      {notifyFailed && (
        <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm leading-relaxed text-amber-800">
          We took this message but couldn&apos;t text it to you — this may be the first you&apos;re
          seeing of it.{" "}
          {settingsHref ? (
            <Link href={settingsHref} className="font-semibold underline">
              Check your notification number
            </Link>
          ) : (
            <span className="font-semibold">Check your notification number</span>
          )}{" "}
          so the next one reaches your phone.
        </p>
      )}

      {number && (
        <a
          href={`tel:${number.replace(/[^\d+]/g, "")}`}
          className="mt-3 inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-brand px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-dark"
        >
          📞 Call back {prettyPhone(number)}
        </a>
      )}

      {/* The success case stays quiet — it's the norm, and a green badge on every card would
          drown out the amber one that actually needs attention. */}
      {owedNotification && call.notifiedAt && (
        <p className="mt-2 text-xs text-ink-soft">
          Texted to you {whenLabel(call.notifiedAt, timezone)}
        </p>
      )}

      {call.transcript && (
        <details className="group mt-3">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center text-sm font-semibold text-brand hover:underline">
            <span className="group-open:hidden">Read the full conversation →</span>
            <span className="hidden group-open:inline">Hide conversation</span>
          </summary>
          <p className="mt-2 whitespace-pre-wrap rounded-xl bg-surface p-4 text-sm leading-relaxed text-ink-soft">
            {call.transcript}
          </p>
        </details>
      )}
    </li>
  );
}
