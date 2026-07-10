"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Periodically re-fetches the current server component (router.refresh) so
 * force-dynamic dashboards (prospecting counts, overview stats) stay near
 * real-time without a full reload. Drop it anywhere on a server page.
 *
 * A `router.refresh` on a force-dynamic page re-runs every query on that page,
 * so an unattended tab on a short interval moves gigabytes a day — this exact
 * pattern exhausted the DB's monthly data-transfer quota and took the app down.
 * Guards:
 *   1. PAUSE while the tab is hidden — a backgrounded / forgotten tab must not
 *      keep re-pulling data; it refreshes once on becoming visible again (if a
 *      full interval has elapsed) so it's fresh the moment you return.
 *   2. Self-scheduling timer (not a fixed-phase setInterval): each cycle is timed
 *      from the last refresh, so an out-of-band refresh-on-return can't fire a
 *      second refresh seconds later at a stale interval boundary.
 *   3. Non-finite / tiny `seconds` is coerced and floored to 15s so a bad prop
 *      can never turn this into a tight refresh loop.
 */
export function AutoRefresh({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const safe = Number.isFinite(seconds) ? (seconds as number) : 60;
    const every = Math.max(15, safe) * 1000;
    let last = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const doRefresh = () => { last = Date.now(); router.refresh(); };
    const schedule = () => { timer = setTimeout(tick, every); };
    const tick = () => { if (document.visibilityState === "visible") doRefresh(); schedule(); };
    schedule();
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - last >= every) {
        clearTimeout(timer); doRefresh(); schedule(); // reset the phase so no double-fire follows
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [router, seconds]);
  return null;
}
