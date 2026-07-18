import Link from "next/link";

import { Card } from "@/components/ui";

const STEPS = [
  {
    n: "01",
    title: "We build your site — and reserve it",
    body: "Most clients meet us this way: we build your website before you ever ask, then send a claim code by email, text, or a call from our AI receptionist.",
  },
  {
    n: "02",
    title: "Create your account & claim it",
    body: "Log in, create a free account, and enter your claim code. The site becomes yours to manage in your portal — live in minutes.",
  },
  {
    n: "03",
    title: "Book a strategy call — from your account",
    body: "Once you're set up, book a strategy call right from your portal. We map which AI services move the needle for your business — an AI receptionist, agents that run the busywork, or a full-stack custom build.",
  },
  {
    n: "04",
    title: "We build, host, and run it",
    body: "You make more sales, run more efficiently, and save time and money. We ship it, maintain it, and scale what works as you grow.",
  },
];

const PILLARS = [
  {
    title: "Senior engineering",
    body: "You work with the people who actually build your system — no account managers in between.",
  },
  {
    title: "Embedded, not bolted on",
    body: "Agents wired into your CRM, ERP, or DMS through secure integrations — automation inside the tools you already run.",
  },
  {
    title: "Production-grade",
    body: "We ship systems that run the work and maintain them as you grow — not pilots that get abandoned.",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="border-t border-line bg-surface">
      <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
        <div className="grid gap-16 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="lg:sticky lg:top-28 lg:self-start">
            <p className="text-sm font-semibold tracking-wide text-brand uppercase">
              How it works
            </p>
            <h2 className="mt-3 text-4xl font-extrabold leading-tight tracking-tight md:text-5xl">
              From claim code to a business that runs itself.
            </h2>
            <p className="mt-6 max-w-md leading-relaxed text-ink-soft">
              ThinkBigJoe builds websites and AI solutions for qualified,
              established businesses. Here&apos;s the path from your reserved site
              to the AI that runs behind it.
            </p>

            <Card className="mt-8">
              <p className="text-sm font-semibold text-ink">Prefer to talk?</p>
              <p className="mt-1 text-sm leading-relaxed text-ink-soft">
                Call our AI receptionist any time — she&apos;ll walk you through
                creating your account and claiming your site.
              </p>
              <a
                href="tel:+14807642121"
                className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-brand hover:underline"
              >
                📞 (480) 764-2121 · 24/7
              </a>
            </Card>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/portal/claim"
                className="inline-flex items-center justify-center rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-dark"
              >
                Claim your site
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center justify-center rounded-full border border-line bg-background px-6 py-3 text-sm font-semibold text-ink transition-colors hover:bg-surface"
              >
                Create an account
              </Link>
            </div>
          </div>

          <div>
            <ol className="space-y-px overflow-hidden rounded-2xl border border-line bg-line">
              {STEPS.map((s) => (
                <li key={s.n} className="flex gap-6 bg-background p-8 md:p-10">
                  <span className="text-2xl font-extrabold tabular-nums text-brand">
                    {s.n}
                  </span>
                  <div>
                    <h3 className="text-xl font-bold tracking-tight">{s.title}</h3>
                    <p className="mt-2 leading-relaxed text-ink-soft">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="mt-8 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-3">
              {PILLARS.map((p) => (
                <div key={p.title} className="bg-background p-5">
                  <h3 className="text-sm font-bold tracking-tight">{p.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                    {p.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
