/*
 * "Sound familiar?" — replaced the Testimonials section on 2026-10-26.
 * Those were invented quotes from invented customers ("Marcus · Plumbing"); TBJ has no paying
 * customers yet, and made-up reviews break the FTC's fake-review rule and backfire with local
 * trades who know each other. These are SITUATIONS the owner recognizes, not quotes. When real
 * customers say real things (with permission), add a testimonials section back.
 */
const situations = [
  {
    problem: "You're up on a roof in July and miss four calls.",
    fix: "We answer all four. You get a text with each one: name, address, what's wrong, and how soon they need you.",
    trade: "Roofing",
  },
  {
    problem: "An AC dies in Palm Desert at 9pm on a Saturday.",
    fix: "We pick up, get the details, and flag it as urgent — so you can decide whether to roll a truck tonight or book first thing.",
    trade: "HVAC",
  },
  {
    problem: "You sent a $12,000 remodel quote and never heard back.",
    fix: "We follow up for you, politely, a few times. Plenty of jobs are won just by being the one who called back.",
    trade: "Remodeling",
  },
];

export function Situations() {
  return (
    <section id="examples">
      <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold tracking-wide text-brand uppercase">
            Sound familiar?
          </p>
          <h2 className="mt-3 text-4xl font-extrabold leading-tight tracking-tight md:text-5xl">
            The jobs you lose are the calls you can&apos;t take.
          </h2>
        </div>

        <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-3">
          {situations.map((s) => (
            <div key={s.trade} className="flex flex-col bg-background p-8 md:p-10">
              <p className="text-xs font-semibold tracking-wide text-ink-soft uppercase">
                {s.trade}
              </p>
              <p className="mt-3 text-lg font-bold leading-snug tracking-tight text-ink">
                {s.problem}
              </p>
              <p className="mt-4 flex-1 leading-relaxed text-ink-soft">
                <span className="font-semibold text-brand">With us: </span>
                {s.fix}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
