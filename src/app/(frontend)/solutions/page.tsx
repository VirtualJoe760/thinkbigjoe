import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { PortalHeader } from "@/components/portal/portal-header";
import { auth } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { SOLUTIONS } from "@/lib/solutions";

export const metadata: Metadata = {
  title: "Agentic Solutions",
  description:
    "How we build custom AI agents for your business — to solve the problems draining your team, to scale what you do without adding headcount, and to close more sales.",
};

// The three outcomes every agent we build is pointed at. The examples and
// process below all ladder up to these.
const PILLARS = [
  {
    title: "Solve problems",
    body: "We find the work that quietly costs you — the manual follow-ups, the data re-entry, the leads that go cold — and build an agent that handles it inside the systems you already run on.",
  },
  {
    title: "Scale the business",
    body: "Agents let you take on more without adding headcount. The work that used to gate your growth — intake, scheduling, back-office ops — runs on its own, so your team spends its time where it counts.",
  },
  {
    title: "Make more sales",
    body: "Every lead answered in seconds, every quote followed up, every caller booked. We build agents that work your pipeline around the clock so revenue stops leaking through the cracks.",
  },
];

const PHASES = [
  {
    n: "01",
    title: "Understand the work",
    body: "We start by learning how your business actually runs — the workflows, the systems, where time and money leak. No two businesses are the same, so nothing is templated until we've seen yours.",
  },
  {
    n: "02",
    title: "Design the agent",
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

export default async function SolutionsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const { user } = session;

  return (
    <div className="flex flex-1 flex-col">
      <PortalHeader email={user.email} isAdmin={isAdminEmail(user.email)} />
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
              Agentic Solutions
            </div>
            <h1 className="mt-8 max-w-4xl text-4xl font-extrabold leading-[1.05] tracking-tight text-balance md:text-6xl">
              Agents that solve the problem, scale the business, and close more
              sales.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-soft md:text-xl">
              We don&apos;t sell software seats or one-size-fits-all tools. We
              build custom AI agents around how your business actually works —
              pointed at real outcomes and wired into your systems — then stay on
              to keep them running as you grow.
            </p>
            <div className="mt-10">
              <Link
                href="/portal/book"
                className="inline-flex items-center justify-center rounded-full bg-brand px-7 py-3.5 text-base font-semibold text-white transition-colors hover:bg-brand-dark"
              >
                Book a strategy call
              </Link>
            </div>
          </div>
        </section>

        {/* The three outcomes */}
        <section className="border-t border-line bg-surface">
          <div className="mx-auto max-w-6xl px-6 py-16 md:py-20">
            <p className="text-sm font-semibold tracking-wide text-brand uppercase">
              What we build agents to do
            </p>
            <h2 className="mt-3 max-w-2xl text-3xl font-extrabold tracking-tight md:text-4xl">
              Every agent earns its keep three ways.
            </h2>
            <div className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-3">
              {PILLARS.map((p) => (
                <div key={p.title} className="bg-background p-8">
                  <h3 className="text-lg font-bold tracking-tight">{p.title}</h3>
                  <p className="mt-3 leading-relaxed text-ink-soft">{p.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* What building an agent looks like */}
        <section className="mx-auto max-w-6xl px-6 py-20 md:py-28">
          <p className="text-sm font-semibold tracking-wide text-brand uppercase">
            Examples of the work
          </p>
          <h2 className="mt-3 max-w-2xl text-3xl font-extrabold tracking-tight md:text-4xl">
            What building an agent looks like.
          </h2>
          <p className="mt-4 max-w-2xl leading-relaxed text-ink-soft">
            Every project is custom, but the shape is often familiar. Here are a
            few of the problems we build agents to solve — and what putting one to
            work inside your business actually involves.
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
                    What an agent like this does
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
            business — we figure out together where a custom agent earns its keep,
            and what it would take to build it.
          </p>
        </section>

        {/* The development journey */}
        <section className="border-t border-line bg-surface">
          <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
            <p className="text-sm font-semibold tracking-wide text-brand uppercase">
              How we work together
            </p>
            <h2 className="mt-3 max-w-2xl text-3xl font-extrabold tracking-tight md:text-4xl">
              From your workflows to a working agent.
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
            href="/portal/book"
            className="mt-8 inline-flex items-center justify-center rounded-full bg-brand px-7 py-3.5 text-base font-semibold text-white transition-colors hover:bg-brand-dark"
          >
            Book a strategy call
          </Link>
        </section>
      </main>
    </div>
  );
}
