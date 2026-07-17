import type { Metadata } from "next";
import Link from "next/link";

import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteNav } from "@/components/marketing/site-nav";

export const metadata: Metadata = {
  title: "AI Agent Sales Pipelines",
  description:
    "How ThinkBigJoe's AI agents run your sales pipeline — capturing every lead, following up instantly, and booking jobs around the clock so nothing slips through the cracks.",
};

// The money story: where revenue leaks today vs. what an agent pipeline closes.
const LEAKS = [
  { stat: "78%", label: "of customers buy from the business that responds first", body: "If you call back tomorrow, the job's already gone. An agent answers in seconds — every time." },
  { stat: "50%", label: "of leads never get a second follow-up", body: "Most sales need 5+ touches. Manual follow-up runs out of steam; an agent never forgets and never quits." },
  { stat: "24/7", label: "your competitors aren't answering after 5pm", body: "Nights, weekends, mid-job — the agent captures, qualifies, and books while you're on the tools." },
];

const PIPELINE = [
  { n: "01", title: "Capture", body: "Every call, form, text, and DM lands in one place — no lead lost to a missed call or a full voicemail." },
  { n: "02", title: "Qualify", body: "The agent asks the right questions, figures out the job, and scores the lead so you spend time on the ones worth closing." },
  { n: "03", title: "Follow up", body: "Instant first response, then a persistent, human-sounding follow-up cadence until they book or bow out." },
  { n: "04", title: "Book", body: "It offers real openings and drops the job straight onto your calendar — with reminders so they show." },
  { n: "05", title: "Nurture", body: "Past customers and cold leads get re-engaged automatically, turning your list into repeat revenue." },
];

export default function AgenticPage() {
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
              maskImage: "radial-gradient(ellipse 80% 60% at 50% 0%, black 40%, transparent 75%)",
            }}
          />
          <div className="relative mx-auto max-w-6xl px-6 pt-20 pb-16 md:pt-28 md:pb-20">
            <div className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold uppercase tracking-wide text-ink-soft">
              <span className="h-1.5 w-1.5 rounded-full bg-brand" />
              AI agent sales pipelines
            </div>
            <h1 className="mt-8 max-w-4xl text-4xl font-extrabold leading-[1.05] tracking-tight text-balance md:text-6xl">
              An AI agent that sells for you — around the clock.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-soft md:text-xl">
              Most businesses don&apos;t have a lead problem — they have a follow-up problem. We build AI
              agents that capture every lead, respond in seconds, follow up until they book, and put the
              job on your calendar. It&apos;s a salesperson that never sleeps, never forgets, and costs a
              fraction of a hire.
            </p>
            <div className="mt-10 flex flex-wrap gap-3">
              <Link
                href="/book-appointment"
                className="inline-flex items-center justify-center rounded-full bg-brand px-7 py-3.5 text-base font-semibold text-white transition-colors hover:bg-brand-dark"
              >
                Book an agentic strategy call
              </Link>
              <Link
                href="/login?redirect=/portal"
                className="inline-flex items-center justify-center rounded-full border border-line bg-background px-7 py-3.5 text-base font-semibold text-ink transition-colors hover:bg-surface"
              >
                Create an account
              </Link>
            </div>
          </div>
        </section>

        {/* Where the money leaks */}
        <section className="border-t border-line bg-surface">
          <div className="mx-auto max-w-6xl px-6 py-16 md:py-20">
            <p className="text-sm font-semibold uppercase tracking-wide text-brand">Where the money leaks</p>
            <h2 className="mt-3 max-w-2xl text-3xl font-extrabold tracking-tight md:text-4xl">
              Every unanswered lead is a job your competitor books.
            </h2>
            <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-3">
              {LEAKS.map((l) => (
                <div key={l.stat} className="bg-background p-8">
                  <div className="text-4xl font-extrabold tracking-tight text-brand tabular-nums">{l.stat}</div>
                  <p className="mt-2 font-semibold tracking-tight text-ink">{l.label}</p>
                  <p className="mt-3 text-sm leading-relaxed text-ink-soft">{l.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* The pipeline */}
        <section className="mx-auto max-w-6xl px-6 py-20 md:py-28">
          <p className="text-sm font-semibold uppercase tracking-wide text-brand">How the pipeline works</p>
          <h2 className="mt-3 max-w-2xl text-3xl font-extrabold tracking-tight md:text-4xl">
            Capture → qualify → follow up → book → nurture.
          </h2>
          <p className="mt-4 max-w-2xl leading-relaxed text-ink-soft">
            We build each stage as an agent wired into the tools you already use — your phone, inbox,
            calendar, and site — so leads move from first touch to booked job without you lifting a finger.
          </p>
          <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-5">
            {PIPELINE.map((p) => (
              <div key={p.n} className="bg-background p-6">
                <span className="text-sm font-bold text-brand">{p.n}</span>
                <h3 className="mt-3 text-lg font-bold tracking-tight">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">{p.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* What you get — the Complete tier */}
        <section className="border-t border-line bg-surface">
          <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
            <div className="grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-brand">Built for your business</p>
                <h2 className="mt-3 text-3xl font-extrabold tracking-tight md:text-4xl">
                  Bespoke agents, not another app to log into.
                </h2>
                <p className="mt-4 leading-relaxed text-ink-soft">
                  This is our <span className="font-semibold text-ink">Complete</span> package — the top tier.
                  Joe designs and builds the agents around how your business actually runs, then stays on to
                  keep them sharp. Because it&apos;s custom, it starts with a conversation, not a checkout.
                </p>
                <Link
                  href="/book-appointment"
                  className="mt-8 inline-flex items-center justify-center rounded-full bg-brand px-7 py-3.5 text-base font-semibold text-white transition-colors hover:bg-brand-dark"
                >
                  Book an agentic strategy call
                </Link>
              </div>
              <ul className="space-y-3">
                {[
                  "A voice agent that answers your phone and books jobs 24/7",
                  "Instant lead capture + follow-up across phone, email, and text",
                  "Qualification + lead scoring so you focus on the best jobs",
                  "Automatic calendar booking with reminders",
                  "Re-engagement of past customers and cold leads",
                  "Wired into your CRM, calendar, and site through secure integrations",
                  "Ongoing tuning + support as your business grows",
                ].map((item) => (
                  <li key={item} className="flex gap-3 rounded-xl border border-line bg-background p-4 text-sm leading-relaxed">
                    <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-3xl px-6 py-20 text-center md:py-28">
          <h2 className="text-3xl font-extrabold tracking-tight md:text-4xl">
            See what an agent could book for you.
          </h2>
          <p className="mx-auto mt-4 max-w-xl leading-relaxed text-ink-soft">
            Book a 30-minute agentic strategy call. We&apos;ll map where leads are slipping and what an
            AI sales pipeline would capture — with a custom plan for your business. No pitch.
          </p>
          <Link
            href="/book-appointment"
            className="mt-8 inline-flex items-center justify-center rounded-full bg-brand px-7 py-3.5 text-base font-semibold text-white transition-colors hover:bg-brand-dark"
          >
            Book an agentic strategy call
          </Link>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
