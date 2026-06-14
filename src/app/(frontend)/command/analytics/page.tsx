import type { Metadata } from "next";

import { requireAdmin } from "@/lib/require-admin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Analytics",
  robots: { index: false, follow: false },
};

const VERCEL_ANALYTICS_URL =
  "https://vercel.com/joes-projects-e3fd5dcd/thinkbigjoe-cyio/analytics";

export default async function AnalyticsPage() {
  await requireAdmin();

  return (
    <div className="px-6 py-8">
      <div className="mx-auto w-full max-w-4xl">
        <h1 className="text-2xl font-extrabold tracking-tight">Site analytics</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Visitor and pageview tracking runs on Vercel Web Analytics (privacy-friendly, no
          cookies).
        </p>

        <div className="mt-6 rounded-2xl border border-line bg-background p-6">
          <p className="text-sm leading-relaxed text-ink-soft">
            The tracking script is live on every page. The dashboards (visitors, top pages,
            referrers, devices) live in the Vercel project — open them here:
          </p>
          <a
            href={VERCEL_ANALYTICS_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex items-center justify-center rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-dark"
          >
            Open Vercel Analytics ↗
          </a>
          <p className="mt-4 text-xs text-ink-soft">
            First time: enable Web Analytics in the Vercel project (Analytics tab → Enable) for
            data to start collecting. Numbers appear within a few minutes of traffic.
          </p>
        </div>

        <div className="mt-4 rounded-2xl border border-line bg-surface p-5 text-sm text-ink-soft">
          <p className="font-medium text-ink">Want these numbers natively in here?</p>
          <p className="mt-1">
            Vercel keeps analytics in its own dashboard; pulling them into this page needs their
            API (a later add). For now this links out — the funnel data (leads, appointments)
            that matters most already lives in the other tabs.
          </p>
        </div>
      </div>
    </div>
  );
}
