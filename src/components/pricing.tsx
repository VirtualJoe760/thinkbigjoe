import Link from "next/link";

const tiers = [
  {
    name: "Website",
    price: "$99",
    cadence: "/mo",
    note: "+ one-time build fee",
    tagline: "A modern site, built and maintained for you.",
    features: [
      "Custom-designed website",
      "Hosting, updates & maintenance",
      "Ongoing content edits",
      "Mobile-fast & SEO-ready",
    ],
    featured: false,
  },
  {
    name: "Website + Voice",
    price: "$299",
    cadence: "/mo",
    note: "+ one-time build fee",
    tagline: "Never miss a call — the AI answers and books it.",
    features: [
      "Everything in Website",
      "AI voice receptionist, 24/7",
      "Books jobs to your calendar",
      "Call summaries & lead capture",
    ],
    featured: true,
  },
  {
    name: "Complete",
    price: "$999",
    cadence: "/mo",
    note: "everything, done for you",
    tagline: "Your whole front office, run by AI.",
    features: [
      "Everything in Website + Voice",
      "AI chat widget on your site",
      "AI sales system — finds & books leads",
      "Priority support",
    ],
    featured: false,
  },
];

export function Pricing() {
  return (
    <section id="pricing" className="border-t border-line bg-background">
      <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold tracking-wide text-brand uppercase">
            Pricing
          </p>
          <h2 className="mt-3 text-4xl font-extrabold tracking-tight md:text-5xl">
            Simple plans that grow with you.
          </h2>
          <p className="mt-4 leading-relaxed text-ink-soft">
            Start with a website, add an AI that answers your phone, or hand us
            the whole thing. No long-term contracts — cancel anytime.
          </p>
        </div>

        <div className="mt-14 grid gap-6 lg:grid-cols-3">
          {tiers.map((t) => (
            <div
              key={t.name}
              className={`relative flex flex-col rounded-2xl border p-8 ${
                t.featured
                  ? "border-brand bg-brand-tint shadow-lg shadow-brand/10"
                  : "border-line bg-surface"
              }`}
            >
              {t.featured && (
                <span className="absolute -top-3 left-8 rounded-full bg-brand px-3 py-1 text-xs font-bold tracking-wide text-white uppercase">
                  Most popular
                </span>
              )}
              <h3 className="text-lg font-bold tracking-tight">{t.name}</h3>
              <p className="mt-1 text-sm text-ink-soft">{t.tagline}</p>

              <div className="mt-6 flex items-baseline gap-1">
                <span className="text-5xl font-extrabold tracking-tight">
                  {t.price}
                </span>
                <span className="text-lg font-semibold text-ink-soft">
                  {t.cadence}
                </span>
              </div>
              <p className="mt-1 text-sm text-ink-soft">{t.note}</p>

              <ul className="mt-8 flex-1 space-y-3">
                {t.features.map((f) => (
                  <li key={f} className="flex items-start gap-3 text-sm">
                    <svg
                      className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      aria-hidden
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 011.4-1.4l3.3 3.3 6.8-6.8a1 1 0 011.4 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <span className="leading-snug">{f}</span>
                  </li>
                ))}
              </ul>

              <Link
                href="/book-appointment"
                className={`mt-8 inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-semibold transition-colors ${
                  t.featured
                    ? "bg-brand text-white hover:bg-brand-dark"
                    : "border border-line bg-background text-ink hover:bg-surface"
                }`}
              >
                Get started
              </Link>
            </div>
          ))}
        </div>

        <p className="mt-8 text-sm text-ink-soft">
          Not sure which fits? <Link href="/book-appointment" className="font-semibold text-brand hover:underline">Book a free strategy call</Link> or
          call <a href="tel:+14807642121" className="font-semibold text-brand hover:underline">(480) 764-2121</a> and our AI will help you decide.
        </p>
      </div>
    </section>
  );
}
