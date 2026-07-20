// The one visual on the usage page. Deliberately a bar and not a chart: the reader is a plumber
// checking whether they're about to get a surprise on their card, not an analyst looking for a
// trend. A bar answers "am I fine?" in under a second; a time-series doesn't.

/** Tone thresholds mirror the policy's warning points (80% / 100%) so the color and the copy on
 *  the page can never disagree about what state the customer is in. */
export type UsageTone = "ok" | "near" | "over";

/**
 * Takes `pctUsed` straight from currentPeriodUsage() rather than recomputing it from
 * minutes/allowance. Those are the same 80/100 thresholds the warning cron fires on, so deriving
 * them separately here would let the page and the customer's warning email disagree about whether
 * they're "close" — and a rounding difference is enough to do it.
 *
 * `null` (a tier with no receptionist) is "ok", not "over": no allowance means no meter.
 */
export function usageTone(pctUsed: number | null): UsageTone {
  if (pctUsed == null) return "ok";
  if (pctUsed >= 100) return "over";
  if (pctUsed >= 80) return "near";
  return "ok";
}

const FILL: Record<UsageTone, string> = {
  ok: "bg-brand",
  // Amber, not red, at both of the warning stages. Red reads as "broken/stopped" and service
  // NEVER stops on overage — a red bar would tell the customer something untrue about their phone.
  near: "bg-amber-500",
  over: "bg-amber-500",
};

export function UsageMeter({
  minutesUsed,
  includedMinutes,
  tone,
}: {
  minutesUsed: number;
  includedMinutes: number;
  tone: UsageTone;
}) {
  // Capped at 100 so the fill can't overflow its track when they're over. The overage itself is
  // communicated in words below the bar, where it can be reassuring — a bar that visually bursts
  // its container reads as an error state.
  const pct = includedMinutes > 0 ? Math.min(100, (minutesUsed / includedMinutes) * 100) : 0;

  return (
    <div>
      <div
        className="h-3 w-full overflow-hidden rounded-full bg-surface"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={includedMinutes}
        aria-valuenow={Math.min(minutesUsed, includedMinutes)}
        aria-label={`${minutesUsed} of ${includedMinutes} included minutes used this month`}
      >
        <div
          className={`h-full rounded-full transition-all ${FILL[tone]}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-xs text-ink-soft tabular-nums">
        <span>0</span>
        <span>{includedMinutes.toLocaleString()} min included</span>
      </div>
    </div>
  );
}
