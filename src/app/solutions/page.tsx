import type { Metadata } from "next";
import Link from "next/link";

import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";
import { SOLUTIONS } from "@/lib/solutions";

export const metadata: Metadata = {
  title: "How We Build",
  description:
    "What it looks like to have a custom AI solution developed for your business — from understanding the work, to building agents into your systems, to a long-term partnership that keeps them running.",
};

const PHASES = [
  {
    n: "01",
    title: "Understand the work",
    body: "We start by learning how your business actually runs — the workflows, the systems, where time and money leak. No two businesses are the same, so nothing is templated until we've seen yours.",
  },
  {
    n: "02",
    title: "Design the solution",
    body: "We map the highest-leverage place to start and design an agent around it — what it does, where a human stays in the loop, and how it lives inside the tools you already use.",
  },
  {
    n: "03",
    title: "Build it into your systems",
    body: "We build it custom and wire it into your systems of record through MCP. You see it working against your real data, with a review queue from day one — not a demo on fake inputs.",
  },
  {
    n: "04",
    title: "Partner for the long run",
    body: "Software that isn't maintained gets ripped out. We stay on as an ongoing partner — monitoring, tuning accuracy, and expanding what the agent handles as your business grows.",
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
              How we build
            </div>
            <h1 className="mt-8 max-w-4xl text-4xl font-extrabold leading-[1.05] tracking-tight text-balance md:text-6xl">
              Custom AI, built for how your business actually works.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-soft md:text-xl">
              We don&apos;t sell software seats or one-size-fits-all tools. We
              develop agents tailored to your workflows and built into your
              systems — then stay on to keep them running as your business
              changes.
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

        {/* Principles */}
        <section className="border-t border-line bg-surface">
          <div className="mx-auto max-w-6xl px-6 py-16 md:py-20">
            <div className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-3">
              <div className="bg-background p-8">
                <h3 className="text-lg font-bold tracking-tight">
                  Built around your business
                </h3>
                <p className="mt-3 leading-relaxed text-ink-soft">
                  Every engagement starts from your actual workflows and data —
                  not a generic template you bend yourself to fit.
                </p>
              </div>
              <div className="bg-background p-8">
                <h3 className="text-lg font-bold tracking-tight">
                  Embedded in your systems
                </h3>
                <p className="mt-3 leading-relaxed text-ink-soft">
                  Agents connect into your CRM, ERP, PSA, or DMS through MCP, so
                  they work inside the tools your team already runs on.
                </p>
              </div>
              <div className="bg-background p-8">
                <h3 className="text-lg font-bold tracking-tight">
                  A partnership, not a handoff
                </h3>
                <p className="mt-3 leading-relaxed text-ink-soft">
                  We don&apos;t ship and disappear. We stay on to keep accuracy
                  high and grow the solution alongside you.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* What developing a solution looks like */}
        <section className="mx-auto max-w-6xl px-6 py-20 md:py-28">
          <p className="text-sm font-semibold tracking-wide text-brand uppercase">
            Examples of the work
          </p>
          <h2 className="mt-3 max-w-2xl text-3xl font-extrabold tracking-tight md:text-4xl">
            What developing a solution looks like.
          </h2>
          <p className="mt-4 max-w-2xl leading-relaxed text-ink-soft">
            Every project is custom, but the shape is often familiar. Here are a
            few of the problems we develop solutions for — and what building one
            into your business actually involves.
          </p>

          <div className="mt-12 space-y-12">
            {SOLUTIONS.map((s, i) => (
              <div
                key={s.slug}
                className={`grid gap-8 lg:grid-cols-[1fr_1.2fr] lg:gap-16 ${
                  i > 0 ? "border-t border-line pt-12" : ""
                }`}
              >
                <div>
                  <p className="text-xs font-semibold tracking-wide text-ink-soft uppercase">
                    {s.verticals}
                  </p>
                  <h3 className="mt-3 text-2xl font-bold tracking-tight md:text-3xl">
                    {s.name}
                  </h3>
                  <p className="mt-4 leading-relaxed text-ink-soft">
                    {s.problem}
                  </p>
                  <Link
                    href={`/for/${s.industry}`}
                    className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:underline"
                  >
                    See how this fits your industry
                    <span aria-hidden>→</span>
                  </Link>
                </div>

                <div>
                  <p className="text-sm font-semibold tracking-tight">
                    What a solution like this does
                  </p>
                  <ul className="mt-3 space-y-2.5">
                    {s.delivers.map((item) => (
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
                  <div className="mt-5 rounded-xl border border-line bg-surface p-5">
                    <p className="text-xs font-semibold tracking-wide text-brand uppercase">
                      How we build it
                    </p>
                    <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                      {s.craft}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <p className="mt-12 max-w-3xl leading-relaxed text-ink-soft">
            These are just starting points. The first conversation is about your
            business — we figure out together where a custom solution earns its
            keep, and what it would take to build it.
          </p>
        </section>

        {/* The development journey */}
        <section className="border-t border-line bg-surface">
          <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
            <p className="text-sm font-semibold tracking-wide text-brand uppercase">
              How we work together
            </p>
            <h2 className="mt-3 max-w-2xl text-3xl font-extrabold tracking-tight md:text-4xl">
              From your workflows to a working solution.
            </h2>
            <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
              {PHASES.map((phase) => (
                <div key={phase.n} className="bg-background p-8">
                  <span className="text-sm font-bold text-brand">{phase.n}</span>
                  <h3 className="mt-4 text-xl font-bold tracking-tight">
                    {phase.title}
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-ink-soft">
                    {phase.body}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-8 max-w-3xl leading-relaxed text-ink-soft">
              Every engagement is scoped to your project — a build, and an
              ongoing partnership to keep it running. We&apos;ll walk you through
              exactly what that looks like for your business on the first call.
            </p>
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-3xl px-6 py-20 text-center md:py-28">
          <h2 className="text-3xl font-extrabold tracking-tight md:text-4xl">
            Let&apos;s find what&apos;s worth building first.
          </h2>
          <p className="mx-auto mt-4 max-w-xl leading-relaxed text-ink-soft">
            Tell us about your business and book a free 30-minute strategy call.
            We&apos;ll map the highest-leverage place to start — no pitch.
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
