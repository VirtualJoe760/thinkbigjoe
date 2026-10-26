import type { Metadata } from "next";

import { SiteNav } from "@/components/marketing/site-nav";
import { SiteFooter } from "@/components/marketing/site-footer";
import { ReferralForm } from "./referral-form";

/*
 * KEYS FOR CODE (2026-10-26) — home service pros refer real estate clients to Joe (a licensed
 * realtor); when the client's escrow closes, the referrer earns a free full-stack website.
 *
 * ⚠️ DRAFT. Not linked from the nav and noindex until Joe launches it. Before launch:
 *   1. Broker / real-estate attorney sign-off — a thing of value given for referring someone to a
 *      settlement service can fall under RESPA §8 and CA DRE referral-fee rules. See
 *      docs/KEYS_FOR_CODE.md.
 *   2. The form is a preview: submissions are not saved or sent to jpsrealtor.com yet.
 * Advertising for a licensee must carry the name, DRE# and broker — keep the disclosure block.
 */
export const metadata: Metadata = {
  title: "Keys for Code — refer a client, get a free website",
  description:
    "Coachella Valley home service pros: refer a home buyer or seller to Joe Sardella, REALTOR®. When their sale closes, we build your business a full custom website — free.",
  robots: { index: false, follow: false },
};

const GETS = [
  {
    title: "Customer logins + job tracking",
    body: "Your customers log in to see where their job stands — scheduled, in progress, done — with photos and notes.",
  },
  {
    title: "Take payments online",
    body: "Send invoices and take deposits by card, right from your website.",
  },
  {
    title: "Estimate calculator",
    body: "Customers get a ballpark price on your site before they call, so the leads you get already know your range.",
  },
  {
    title: "AI remodel previews",
    body: "A customer uploads a photo of their kitchen or bath, picks from your materials, and AI shows them what the finished job could look like.",
  },
  {
    title: "A website that wins work",
    body: "Fast, modern, great on a phone — with your reviews, your best jobs and one-tap calling.",
  },
  {
    title: "Secure accounts built in",
    body: "Proper sign-in for you, your team and your customers, so private job details stay private.",
  },
];

const STEPS = [
  {
    n: "1",
    title: "Send us your client",
    body: "Fill out the form below with your client's name and how to reach them, and whether they're buying, selling or both.",
  },
  {
    n: "2",
    title: "Make the introduction",
    body: "Start a group text with you, your client and Joe at (760) 333-3676. A quick personal hello from you is what makes it work — that's the warm hand-off.",
  },
  {
    n: "3",
    title: "Joe takes great care of them",
    body: "Joe helps your client buy or sell their home, start to finish. You're kept in the loop.",
  },
  {
    n: "4",
    title: "Escrow closes — your website gets built",
    body: "When the sale closes, your credit is locked in and we start building your custom website.",
  },
];

const FAQ = [
  {
    q: "Who can join?",
    a: "Contractors, plumbers, HVAC, roofers, remodelers, tile and flooring pros, landscapers, pool and solar companies — anyone in home services who works with homeowners in the Coachella Valley.",
  },
  {
    q: "When do I get my website?",
    a: "Your credit is set the day your client's escrow closes. We start your build right after and walk you through what you want on it.",
  },
  {
    q: "What if the deal doesn't close?",
    a: "Then there's no credit for that referral — but you're welcome to keep referring. The credit comes from a closed sale.",
  },
  {
    q: "Does my client pay anything extra?",
    a: "No. Your client works with Joe like any other client. Nothing about the website is added to their side of the deal.",
  },
  {
    q: "What does the free website include?",
    a: "The full custom build described above. Hosting and any ongoing services after launch are separate and optional — we'll go over them before we start.",
  },
  {
    q: "Is my client okay with being contacted?",
    a: "Only send someone who has said yes to hearing from a realtor. The form asks you to confirm that.",
  },
];

export default function KeysForCodePage() {
  return (
    <>
      <SiteNav />
      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="relative mx-auto flex max-w-6xl flex-col items-center px-6 pt-24 pb-20 text-center md:pt-32">
            <div className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold tracking-wide text-ink-soft uppercase">
              <span aria-hidden>🔑</span> Keys for Code · Coachella Valley
            </div>
            <h1 className="mt-8 max-w-4xl text-5xl font-extrabold leading-[1.05] tracking-tight text-balance md:text-7xl">
              Refer a home buyer or seller.
              <br />
              Get a custom <span className="text-brand">website</span>, free.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-soft md:text-xl">
              You already know homeowners who are thinking about moving.
              Introduce them to Joe Sardella — a local REALTOR® and the
              developer behind ThinkBigJoe. When their sale closes, we build
              your business a full custom website at no cost to you.
            </p>
            <div className="mt-10 flex flex-col justify-center gap-3 sm:flex-row">
              <a
                href="#refer"
                className="inline-flex items-center justify-center rounded-full bg-brand px-7 py-3.5 text-base font-semibold text-white transition-colors hover:bg-brand-dark"
              >
                Refer a client
              </a>
              <a
                href="#how"
                className="inline-flex items-center justify-center rounded-full border border-line bg-background px-7 py-3.5 text-base font-semibold text-ink transition-colors hover:bg-surface"
              >
                How it works
              </a>
            </div>
            <p className="mt-6 text-sm text-ink-soft">
              One closed sale = one custom website for your business.
            </p>
          </div>
        </section>

        {/* What you get */}
        <section className="border-t border-line bg-surface">
          <div className="mx-auto max-w-6xl px-6 py-24 md:py-28">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold tracking-wide text-brand uppercase">
                What you get
              </p>
              <h2 className="mt-3 text-4xl font-extrabold tracking-tight md:text-5xl">
                Not a template. A real system for your business.
              </h2>
              <p className="mt-6 leading-relaxed text-ink-soft">
                The kind of website bigger companies pay thousands for — built
                around how you work.
              </p>
            </div>
            <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
              {GETS.map((g) => (
                <div key={g.title} className="bg-background p-8">
                  <h3 className="text-lg font-bold tracking-tight">{g.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-soft">{g.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="border-t border-line">
          <div className="mx-auto max-w-6xl px-6 py-24 md:py-28">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold tracking-wide text-brand uppercase">
                How it works
              </p>
              <h2 className="mt-3 text-4xl font-extrabold tracking-tight md:text-5xl">
                Four steps from &ldquo;I know someone&rdquo; to a new website.
              </h2>
            </div>
            <ol className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((s) => (
                <li key={s.n} className="rounded-2xl border border-line bg-background p-8">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-brand text-lg font-extrabold text-white">
                    {s.n}
                  </span>
                  <h3 className="mt-5 text-lg font-bold tracking-tight">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-soft">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Why Joe */}
        <section className="border-t border-line bg-surface">
          <div className="mx-auto grid max-w-6xl gap-12 px-6 py-24 md:py-28 lg:grid-cols-2">
            <div>
              <p className="text-sm font-semibold tracking-wide text-brand uppercase">
                Who your client works with
              </p>
              <h2 className="mt-3 text-4xl font-extrabold tracking-tight md:text-5xl">
                A realtor who also builds software.
              </h2>
            </div>
            <div className="space-y-4 leading-relaxed text-ink-soft">
              <p>
                Joe Sardella is a REALTOR® with eXp Realty of Southern California
                who lives and works in the Coachella Valley. He helps people buy
                and sell homes from Palm Springs to Indio.
              </p>
              <p>
                He&apos;s also the developer behind ThinkBigJoe — which is why this
                program exists. Your referral helps his real estate business, and
                he pays it back with the thing he knows how to build: a website
                that grows yours.
              </p>
              <p>
                See his listings and reviews at{" "}
                <a
                  href="https://jpsrealtor.com"
                  className="font-semibold text-ink underline decoration-line underline-offset-4 hover:decoration-brand"
                >
                  jpsrealtor.com
                </a>
                .
              </p>
            </div>
          </div>
        </section>

        {/* Referral form */}
        <section id="refer" className="border-t border-line">
          <div className="mx-auto max-w-3xl px-6 py-24 md:py-28">
            <div className="text-center">
              <p className="text-sm font-semibold tracking-wide text-brand uppercase">
                Refer a client
              </p>
              <h2 className="mt-3 text-4xl font-extrabold tracking-tight md:text-5xl">
                Who should Joe meet?
              </h2>
              <p className="mx-auto mt-6 max-w-xl leading-relaxed text-ink-soft">
                Takes about two minutes. After you send it, start a group text
                with your client and Joe to make the introduction.
              </p>
            </div>
            <div className="mt-12">
              <ReferralForm />
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="border-t border-line bg-surface">
          <div className="mx-auto max-w-3xl px-6 py-24 md:py-28">
            <h2 className="text-4xl font-extrabold tracking-tight md:text-5xl">Questions</h2>
            <div className="mt-10 divide-y divide-line rounded-2xl border border-line bg-background">
              {FAQ.map((f) => (
                <details key={f.q} className="group p-6">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-bold tracking-tight">
                    {f.q}
                    <span className="text-brand transition-transform group-open:rotate-45" aria-hidden>
                      +
                    </span>
                  </summary>
                  <p className="mt-3 leading-relaxed text-ink-soft">{f.a}</p>
                </details>
              ))}
            </div>

            {/* Licensee disclosure — required on real estate advertising. Keep it. */}
            <p className="mt-12 text-xs leading-relaxed text-ink-soft">
              Joseph Sardella, REALTOR® · DRE# 02106916 · eXp Realty of Southern
              California. Website credit is earned only when a referred client&apos;s
              purchase or sale closes escrow with Joseph Sardella as their agent,
              and is subject to program terms. Not intended to solicit anyone
              already under contract with another agent. Equal Housing
              Opportunity.
            </p>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
