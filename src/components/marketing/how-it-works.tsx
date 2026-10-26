import Link from "next/link";

import { Card } from "@/components/ui";

// The no-claim-code front door (2026-10-26): free account → business intake → talk with Joe →
// we build. (Claim codes still work — that path is on the intake page and the hero.)
const STEPS = [
  {
    n: "01",
    title: "Create a free account",
    body: "Takes a minute. No credit card, no commitment.",
  },
  {
    n: "02",
    title: "Tell us about your business",
    body: "A few quick questions: what you do, where you work, and what you need — a website, AI that answers your calls, or a full custom system.",
  },
  {
    n: "03",
    title: "Talk with Joe",
    body: "Book a call right from your account. We'll figure out what will make the biggest difference and size it to your business.",
  },
  {
    n: "04",
    title: "We build it and keep it running",
    body: "You run your jobs. We handle the setup, the updates and the fixes.",
  },
];

const PILLARS = [
  {
    title: "Local",
    body: "We work with businesses here in the Coachella Valley.",
  },
  {
    title: "No tech skills needed",
    body: "If you can send a text, you can use everything we build.",
  },
  {
    title: "Month to month",
    body: "No long contracts. Stay because it's working.",
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
              Getting started is simple.
            </h2>
            <p className="mt-6 max-w-md leading-relaxed text-ink-soft">
              We build websites and AI for home service businesses in the
              Coachella Valley — from a first website to a full custom system.
              Here&apos;s how it goes.
            </p>

            <Card className="mt-8">
              <p className="text-sm font-semibold text-ink">Prefer to talk?</p>
              <p className="mt-1 text-sm leading-relaxed text-ink-soft">
                Call any time — Maddie, our assistant, can take your details
                and set up a time for you to talk with Joe.
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
                href="/login"
                className="inline-flex items-center justify-center rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-dark"
              >
                Create a free account
              </Link>
              <Link
                href="/portal/claim"
                className="inline-flex items-center justify-center rounded-full border border-line bg-background px-6 py-3 text-sm font-semibold text-ink transition-colors hover:bg-surface"
              >
                Have a code? Claim your site
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
