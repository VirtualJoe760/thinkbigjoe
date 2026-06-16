import type { Metadata } from "next";

import { PortalHeader } from "@/components/portal/portal-header";
import { requireBrokeAccess } from "@/lib/require-broke-access";

export const metadata: Metadata = {
  title: "broke",
};

const FEATURES = [
  {
    title: "Daily digest",
    body: "An AI brief on your holdings — scored news, position theses, what changed overnight.",
  },
  {
    title: "Trader cockpit",
    body: "Positions with AI confidence, AI trade proposals you approve or reject, risk panel + kill switch.",
  },
  {
    title: "Smart money",
    body: "Recent congressional trades and cross-member consensus. Transparency — not an edge claim.",
  },
  {
    title: "Strategies",
    body: "Pick the strategies you want. Every one is validation-gated before it can touch real money.",
  },
];

export default async function BrokePage() {
  const { email } = await requireBrokeAccess();

  return (
    <div className="flex flex-1 flex-col">
      <PortalHeader email={email} />

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-12">
        <h1 className="text-4xl font-extrabold tracking-tight">broke</h1>
        <p className="mt-3 max-w-2xl text-ink-soft">
          AI trading augmentation — your customizable feed, signals, and copy-trade ideas.
          Paper-first, you bring your own broker. Educational, not investment advice.
        </p>

        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <section key={f.title} className="rounded-2xl border border-line bg-surface p-8">
              <h2 className="text-xl font-bold tracking-tight">{f.title}</h2>
              <p className="mt-2 leading-relaxed text-ink-soft">{f.body}</p>
            </section>
          ))}
        </div>

        <p className="mt-8 text-sm text-ink-soft">
          Live data + interactive dashboards connect to the broke engine — wiring in progress.
        </p>
      </main>
    </div>
  );
}
