import type { Metadata } from "next";
import Link from "next/link";

import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";
import { SOLUTIONS } from "@/lib/solutions";

export const metadata: Metadata = {
  title: "Solutions",
  description:
    "Productized AI automation built once and deployed into your systems — document intake, white-label service desk, and order-intake agents. Setup plus a managed monthly retainer.",
};

const STEPS = [
  {
    n: "01",
    title: "Paid audit",
    body: "A fixed-price workflow audit maps where AI pays back fastest and proves it with a working slice — never free scoping.",
  },
  {
    n: "02",
    title: "Build",
    body: "We build the agent against your real systems and data, with a human-in-the-loop review queue from day one.",
  },
  {
    n: "03",
    title: "Managed operations",
    body: "A monthly retainer keeps it accurate as your business changes — hosting, monitoring, tuning, and model upgrades.",
  },
];

export default function SolutionsPage() {
  return (
    <>
      <SiteNav />
      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.4]"
            style={{
              backgroundImage:
                "linear-gradient(to right, var(--line) 1px, transparent 1px), linear-gradient(to bottom, var(--line) 1px, transparent 1px)",
              backgroundSize: "64px 64px",
              maskImage:
                "radial-gradient(ellipse 80% 60% at 50% 0%, black 40%, transparent 75%)",
            }}
          />
          <div className="relative mx-auto max-w-6xl px-6 pt-20 pb-16 md:pt-28 md:pb-20">
            <div className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold tracking-wide text-ink-soft uppercase">
              <span className="h-1.5 w-1.5 rounded-full bg-brand" />
              Productized solutions
            </div>
            <h1 className="mt-8 max-w-4xl text-4xl font-extrabold leading-[1.05] tracking-tight text-balance md:text-6xl">
              AI agents built once. Deployed into your business. Managed for the
              long run.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-soft md:text-xl">
              Not another SaaS login you&apos;ll cancel in three months. These are
              agents wired directly into your systems of record — priced as a
              setup build plus a managed monthly retainer, because the work that
              actually moves your business is worth keeping running.
            </p>
            <div className="mt-10">
              <Link
                href="/book-appointment"
                className="inline-flex items-center justify-center rounded-full bg-brand px-7 py-3.5 text-base font-semibold text-white transition-colors hover:bg-brand-dark"
              >
                Book a strategy call
              </Link>
            </div>
          </div>
        </section>

        {/* Why this model */}
        <section className="border-t border-line bg-surface">
          <div className="mx-auto max-w-6xl px-6 py-16 md:py-20">
            <div className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-3">
              <div className="bg-background p-8">
                <h3 className="text-lg font-bold tracking-tight">
                  Embedded, not bolted on
                </h3>
                <p className="mt-3 leading-relaxed text-ink-soft">
                  Every agent connects into your CRM, ERP, PSA, or DMS through
                  MCP — it works inside the systems your team already runs on.
                </p>
              </div>
              <div className="bg-background p-8">
                <h3 className="text-lg font-bold tracking-tight">
                  Trained on your data
                </h3>
                <p className="mt-3 leading-relaxed text-ink-soft">
                  Your documents, your rules, your tone. That&apos;s the
                  difference between a tool anyone can buy and one only you can
                  use.
                </p>
              </div>
              <div className="bg-background p-8">
                <h3 className="text-lg font-bold tracking-tight">
                  Managed, not abandoned
                </h3>
                <p className="mt-3 leading-relaxed text-ink-soft">
                  The monthly retainer keeps accuracy high as your business
                  changes. AI that isn&apos;t maintained is AI that gets ripped
                  out.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* The products */}
        <section className="mx-auto max-w-6xl px-6 py-20 md:py-28">
          <p className="text-sm font-semibold tracking-wide text-brand uppercase">
            What we package
          </p>
          <h2 className="mt-3 max-w-2xl text-3xl font-extrabold tracking-tight md:text-4xl">
            Three agents proven to pay for themselves.
          </h2>

          <div className="mt-12 space-y-6">
            {SOLUTIONS.map((s) => (
              <div
                key={s.slug}
                className={`rounded-2xl border bg-background p-8 md:p-10 ${
                  s.featured ? "border-brand shadow-sm" : "border-line"
                }`}
              >
                <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
                  <div className="lg:max-w-xl">
                    <div className="flex items-center gap-3">
                      <p className="text-xs font-semibold tracking-wide text-ink-soft uppercase">
                        {s.verticals}
                      </p>
                      {s.featured && (
                        <span className="rounded-full bg-brand-tint px-2.5 py-0.5 text-xs font-semibold text-brand">
                          Best starting point
                        </span>
                      )}
                    </div>
                    <h3 className="mt-3 text-2xl font-bold tracking-tight md:text-3xl">
                      {s.name}
                    </h3>
                    <p className="mt-2 text-lg font-medium text-brand">
                      {s.tagline}
                    </p>
                    <p className="mt-4 leading-relaxed text-ink-soft">
                      {s.problem}
                    </p>

                    <ul className="mt-6 space-y-2.5">
                      {s.includes.map((item) => (
                        <li key={item} className="flex gap-3 text-sm leading-relaxed">
                          <svg
                            viewBox="0 0 24 24"
                            className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={3}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M20 6 9 17l-5-5" />
                          </svg>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="w-full lg:w-72 lg:flex-shrink-0">
                    <div className="rounded-xl border border-line bg-surface p-6">
                      <p className="text-xs font-semibold tracking-wide text-ink-soft uppercase">
                        Investment
                      </p>
                      <p className="mt-3 text-3xl font-extrabold tracking-tight">
                        {s.setupFrom}
                        <span className="text-base font-semibold text-ink-soft">
                          {" "}
                          setup
                        </span>
                      </p>
                      <p className="mt-1 text-lg font-bold tracking-tight text-ink-soft">
                        + {s.monthlyFrom}
                        <span className="text-sm font-medium"> /mo managed</span>
                      </p>
                      <p className="mt-3 text-xs leading-relaxed text-ink-soft">
                        Final scope set by your audit. Monthly is a managed-AI
                        retainer, not a software seat.
                      </p>
                      <Link
                        href={`/for/${s.industry}#intake`}
                        className="mt-5 inline-flex w-full items-center justify-center rounded-full bg-brand px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-dark"
                      >
                        Start with an audit
                      </Link>
                    </div>
                  </div>
                </div>

                <div className="mt-8 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2">
                  <div className="bg-surface p-5">
                    <p className="text-xs font-semibold tracking-wide text-brand uppercase">
                      Why it can&apos;t be commoditized
                    </p>
                    <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                      {s.moat}
                    </p>
                  </div>
                  <div className="bg-surface p-5">
                    <p className="text-xs font-semibold tracking-wide text-brand uppercase">
                      The proof
                    </p>
                    <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                      {s.proof}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <p className="mt-8 max-w-3xl text-sm leading-relaxed text-ink-soft">
            Need something outside these three? Most engagements start as a
            custom build — these are simply the patterns we&apos;ve productized.
            A strategy call is the fastest way to find yours.
          </p>
        </section>

        {/* How it works */}
        <section className="border-t border-line bg-surface">
          <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
            <p className="text-sm font-semibold tracking-wide text-brand uppercase">
              How engagements work
            </p>
            <h2 className="mt-3 max-w-2xl text-3xl font-extrabold tracking-tight md:text-4xl">
              Audit first. Build what pays back. Keep it running.
            </h2>
            <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-3">
              {STEPS.map((step) => (
                <div key={step.n} className="bg-background p-8">
                  <span className="text-sm font-bold text-brand">{step.n}</span>
                  <h3 className="mt-4 text-xl font-bold tracking-tight">
                    {step.title}
                  </h3>
                  <p className="mt-3 leading-relaxed text-ink-soft">
                    {step.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-3xl px-6 py-20 text-center md:py-28">
          <h2 className="text-3xl font-extrabold tracking-tight md:text-4xl">
            Find the agent worth building first.
          </h2>
          <p className="mx-auto mt-4 max-w-xl leading-relaxed text-ink-soft">
            Tell us about your business and book a free 30-minute strategy call.
            We&apos;ll map the highest-ROI workflow to automate — no pitch.
          </p>
          <Link
            href="/book-appointment"
            className="mt-8 inline-flex items-center justify-center rounded-full bg-brand px-7 py-3.5 text-base font-semibold text-white transition-colors hover:bg-brand-dark"
          >
            Book a strategy call
          </Link>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
