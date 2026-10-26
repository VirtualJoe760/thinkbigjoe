import Link from "next/link";

/*
 * Positioning (Joe, 2026-10-26): we build the WHOLE solution — websites from a simple small-
 * business site up to an enterprise-grade custom platform — with AI agents (voice included) built
 * in. Voice is one feature, not the headline. Plain words, short sentences, local (Coachella
 * Valley home service businesses). The primary button calls us.
 */
export function Hero() {
  return (
    <section id="home" className="relative overflow-hidden">
      {/* subtle grid backdrop */}
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

      <div className="relative mx-auto flex max-w-6xl flex-col items-center px-6 pt-24 pb-20 text-center md:pt-32 md:pb-28">
        <div className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold tracking-wide text-ink-soft uppercase">
          <span className="h-1.5 w-1.5 rounded-full bg-brand" />
          Websites + AI · Coachella Valley
        </div>

        <h1 className="mt-8 max-w-4xl text-5xl font-extrabold leading-[1.05] tracking-tight text-balance md:text-7xl">
          Websites and AI that <span className="text-brand">grow</span> your business.
        </h1>

        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-soft md:text-xl">
          We build everything from a simple website to a full custom system for
          your business — with AI built in that answers your calls, follows up
          with customers and handles the busywork. Made for contractors,
          plumbers, HVAC, roofers and remodelers in the Coachella Valley.
        </p>

        <div className="mt-10 flex flex-col justify-center gap-3 sm:flex-row">
          <a
            href="tel:+14807642121"
            className="inline-flex items-center justify-center rounded-full bg-brand px-7 py-3.5 text-base font-semibold text-white transition-colors hover:bg-brand-dark"
          >
            Call us: (480) 764-2121
          </a>
          <Link
            href="/portal/claim"
            className="inline-flex items-center justify-center rounded-full border border-line bg-background px-7 py-3.5 text-base font-semibold text-ink transition-colors hover:bg-surface"
          >
            Got a code from us? Claim your site
          </Link>
        </div>

        <p className="mt-5 text-sm text-ink-soft">
          We answer 24/7 — even right now.
        </p>

        <dl className="mt-16 grid max-w-3xl grid-cols-1 gap-8 border-t border-line pt-8 text-center sm:grid-cols-3">
          {[
            { k: "Small to enterprise", v: "From a one-page site to a full custom platform" },
            { k: "AI built in", v: "Agents that answer calls, follow up and book jobs" },
            { k: "Done for you", v: "We build it, host it and keep it running" },
          ].map((s) => (
            <div key={s.k}>
              <dt className="text-xl font-bold tracking-tight md:text-2xl">
                {s.k}
              </dt>
              <dd className="mt-1 text-sm text-ink-soft">{s.v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
