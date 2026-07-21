const testimonials = [
  {
    quote:
      "The AI picks up the calls I used to lose after 5pm. I booked two water-heater jobs last week from calls I never would've seen. It pays for itself in a day.",
    name: "Marcus",
    trade: "Plumbing",
  },
  {
    quote:
      "It answers in my voice, gets the address and the problem, and texts me before I'm off the roof. My phone stopped being the thing that runs my day.",
    name: "Dana",
    trade: "Roofing",
  },
  {
    quote:
      "We used to miss a third of our calls on hot days. Now every one gets answered and qualified. More booked jobs, same crew.",
    name: "Ray",
    trade: "HVAC",
  },
];

export function Testimonials() {
  return (
    <section id="testimonials">
      <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold tracking-wide text-brand uppercase">
            Testimonials
          </p>
          <h2 className="mt-3 text-4xl font-extrabold leading-tight tracking-tight md:text-5xl">
            Trusted by businesses focused on growing revenue.
          </h2>
        </div>

        <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-3">
          {testimonials.map((t) => (
            <figure
              key={t.name}
              className="flex flex-col bg-background p-8 md:p-10"
            >
              <span aria-hidden className="text-4xl font-extrabold leading-none text-brand">
                &ldquo;
              </span>
              <blockquote className="mt-4 flex-1 leading-relaxed text-ink">
                {t.quote}
              </blockquote>
              <figcaption className="mt-6 border-t border-line pt-4 text-sm">
                <span className="font-bold tracking-tight text-ink">{t.name}</span>
                <span className="text-ink-soft"> · {t.trade}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
