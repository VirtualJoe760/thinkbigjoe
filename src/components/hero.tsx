import Link from "next/link";

export function Hero() {
  return (
    <section className="relative overflow-hidden">
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

      <div className="relative mx-auto max-w-6xl px-6 pt-24 pb-20 md:pt-32 md:pb-28">
        <div className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold tracking-wide text-ink-soft uppercase">
          <span className="h-1.5 w-1.5 rounded-full bg-brand" />
          Websites · AI Receptionists · AI Sales
        </div>

        <h1 className="mt-8 max-w-4xl text-5xl font-extrabold leading-[1.05] tracking-tight text-balance md:text-7xl">
          A website that wins the click —
          <br />
          and an <span className="text-brand">AI</span> that answers the call.
        </h1>

        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-soft md:text-xl">
          ThinkBigJoe builds local businesses a modern website and an AI
          receptionist that answers every call, books the job, and never sends a
          customer to voicemail — so you stop losing work to the competitor who
          picked up first.
        </p>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/book-appointment"
            className="inline-flex items-center justify-center rounded-full bg-brand px-7 py-3.5 text-base font-semibold text-white transition-colors hover:bg-brand-dark"
          >
            Book a strategy call
          </Link>
          <Link
            href="#pricing"
            className="inline-flex items-center justify-center rounded-full border border-line bg-background px-7 py-3.5 text-base font-semibold text-ink transition-colors hover:bg-surface"
          >
            See pricing
          </Link>
        </div>

        <dl className="mt-16 grid max-w-2xl grid-cols-3 gap-8 border-t border-line pt-8">
          {[
            { k: "24/7", v: "AI answers every call, day or night" },
            { k: "Books jobs", v: "Appointments straight to your calendar" },
            { k: "Done-for-you", v: "We build, host, and run it" },
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
