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
          Plumbing · HVAC · Electrical · Roofing · Garage Door · Restoration
        </div>

        {/*
          Leads with the PHONE, not the website.
          Formula borrowed from the best-converting page in the competitor teardown: job-verbs plus
          "every", and no "AI" in the headline at all. The buyer isn't shopping for AI — he's losing
          jobs to whoever picks up first. The mechanism belongs in the subhead.
          The website stays in the offer because it costs us almost nothing and every voice-only
          rival charges more for the phone alone; it just stops being the first thing we say.
        */}
        <h1 className="mt-8 max-w-4xl text-5xl font-extrabold leading-[1.05] tracking-tight text-balance md:text-7xl">
          Answer every call.
          <br />
          Book every <span className="text-brand">job</span>.
        </h1>

        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-soft md:text-xl">
          An AI receptionist for home service businesses. It picks up 24/7,
          finds out what the job is, and texts you the details before you&apos;re
          off the ladder — so the call you miss at 7pm doesn&apos;t become
          someone else&apos;s job. Your website comes with it.
        </p>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-full bg-brand px-7 py-3.5 text-base font-semibold text-white transition-colors hover:bg-brand-dark"
          >
            Create your account
          </Link>
          <Link
            href="/portal/claim"
            className="inline-flex items-center justify-center rounded-full border border-line bg-background px-7 py-3.5 text-base font-semibold text-ink transition-colors hover:bg-surface"
          >
            Have a claim code? Claim your site
          </Link>
        </div>

        <p className="mt-5 text-sm text-ink-soft">
          Prefer to talk?{" "}
          <a href="tel:+14807642121" className="font-semibold text-ink underline decoration-line underline-offset-4 hover:decoration-brand">
            Call (480) 764-2121
          </a>
          .
        </p>

        <dl className="mt-16 grid max-w-2xl grid-cols-3 gap-8 border-t border-line pt-8">
          {[
            { k: "24/7", v: "AI receptionist answers & books every call" },
            { k: "More sales", v: "Custom systems that fill your pipeline" },
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
