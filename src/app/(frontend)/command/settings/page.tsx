import type { Metadata } from "next";

import { requireAdmin } from "@/lib/require-admin";
import { calendarHealth } from "@/lib/gcal";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Settings",
  robots: { index: false, follow: false },
};

const VERCEL_ANALYTICS_URL = "https://vercel.com/joes-projects-e3fd5dcd/thinkbigjoe-cyio/analytics";

export default async function SettingsPage() {
  await requireAdmin();

  const cal = await calendarHealth();

  return (
    <div className="px-6 py-8">
      <div className="mx-auto w-full max-w-2xl space-y-10">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Settings</h1>
          <p className="mt-1 text-sm text-ink-soft">Integrations and analytics for the command center.</p>
        </div>

        {/* ── Google Calendar ── */}
        <section>
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-soft">Google Calendar</h2>
          <div className="mt-2 rounded-2xl border border-line bg-background p-5">
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                  cal.ok ? "bg-green-100 text-green-800" : cal.configured ? "bg-amber-100 text-amber-800" : "bg-surface text-ink-soft"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${cal.ok ? "bg-green-600" : cal.configured ? "bg-amber-500" : "bg-ink-soft"}`} />
                {cal.ok ? "Connected" : cal.configured ? "Needs attention" : "Not connected"}
              </span>
              <span className="text-sm text-ink-soft">
                {cal.ok
                  ? "Booking is live — invites with a Meet link go out automatically."
                  : cal.configured
                    ? `Credentials are set but the last check failed${cal.error ? ` (${cal.error})` : ""} — the refresh token may need re-authing.`
                    : "GCAL_* environment variables aren't set."}
              </span>
            </div>
          </div>
        </section>

        {/* ── Analytics ── */}
        <section>
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-soft">Analytics</h2>
          <div className="mt-2 rounded-2xl border border-line bg-background p-5">
            <p className="text-sm text-ink-soft">
              Visitor tracking runs on Vercel Web Analytics (privacy-friendly, no cookies). The dashboards live in the Vercel project.
            </p>
            <a
              href={VERCEL_ANALYTICS_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center justify-center rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-dark"
            >
              Open Vercel Analytics ↗
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}
