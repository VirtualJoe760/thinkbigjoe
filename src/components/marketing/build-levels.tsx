/*
 * "Start small, grow into it" (2026-10-26) — shows the range: a starter site → site + AI →
 * an enterprise-grade custom platform. NO PRICES on purpose: plans are never advertised publicly
 * (pricing happens after sign-up / on the call). Keep it that way.
 */
const levels = [
  {
    name: "Get found",
    fit: "Just starting out, or your current site is old",
    items: [
      "A modern website that looks great on a phone",
      "Click-to-call, quote requests and your reviews up front",
      "Shows up when people in the valley search for your trade",
      "We host it and keep it updated",
    ],
  },
  {
    name: "Get organized",
    fit: "Busy, and things are slipping through the cracks",
    items: [
      "Everything in Get found",
      "AI that answers your calls 24/7 and texts you the job",
      "Automatic follow-ups on quotes and review requests",
      "Online booking and a simple dashboard for your leads",
    ],
    featured: true,
  },
  {
    name: "Run it all",
    fit: "Multiple crews or locations, ready for a real system",
    items: [
      "Everything in Get organized",
      "Customer logins with job status, photos and invoices",
      "Custom AI agents built around how your business works",
      "Connected to the tools you already use, built to scale",
    ],
  },
];

const Check = () => (
  <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0 text-brand" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

export function BuildLevels() {
  return (
    <section id="levels" className="border-t border-line">
      <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold tracking-wide text-brand uppercase">
            Small to enterprise
          </p>
          <h2 className="mt-3 text-4xl font-extrabold tracking-tight md:text-5xl">
            Start small. Grow into it.
          </h2>
          <p className="mt-6 leading-relaxed text-ink-soft">
            Whether you need your first website or a full system for a growing
            company, we build what fits today and add to it as you grow. You
            never have to start over.
          </p>
        </div>

        <div className="mt-14 grid gap-6 lg:grid-cols-3">
          {levels.map((l) => (
            <div
              key={l.name}
              className={`flex flex-col rounded-2xl border p-8 ${
                l.featured ? "border-brand bg-brand-tint/40" : "border-line bg-background"
              }`}
            >
              <h3 className="text-2xl font-extrabold tracking-tight">{l.name}</h3>
              <p className="mt-2 text-sm text-ink-soft">{l.fit}</p>
              <ul className="mt-6 space-y-3 text-sm leading-relaxed text-ink">
                {l.items.map((i) => (
                  <li key={i} className="flex gap-3">
                    <Check />
                    <span>{i}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
