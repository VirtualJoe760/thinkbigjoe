/*
 * ORDER IS THE MESSAGE. This list used to open with "Websites That Convert" and run eight
 * co-equal services, which read as "we do a bit of everything" — the least persuasive thing an
 * agency can say, and it buried the receptionist at position two.
 *
 * The phone is what a contractor is actually losing money on, so it goes first and gets the most
 * space. The website stays in the offer (it costs us almost nothing and every voice-only
 * competitor charges more for the phone alone) but it is now the thing that comes WITH the
 * receptionist rather than the headline act.
 */
const services = [
  {
    title: "AI Receptionist",
    body: "Answers every call 24/7 in your business's voice — finds out what the job is, how urgent it is, and where, then texts you the details straight away. The 7pm burst pipe stops going to whoever picks up first.",
  },
  {
    title: "Never Miss After Hours",
    body: "Your phone rings first. We only pick up the calls you'd have lost — nights, weekends, when you're under a sink. You keep every call you can actually take.",
  },
  {
    title: "Your Website, Included",
    body: "A fast, modern site built, hosted and maintained for you. It comes with the receptionist rather than costing extra, and it's where you see every call the AI answered.",
  },
  {
    title: "Follow-Up That Actually Happens",
    body: "Quotes chased, dormant customers reactivated, reviews requested after the job. The work that makes money and never gets done because everyone's on a truck.",
  },
  {
    title: "Custom AI Integrations",
    body: "Secure, permissioned connections that give your AI structured access to the data and systems you already run — the connective tissue between AI and your business.",
  },
  {
    title: "Agentic Software",
    body: "Autonomous agents that handle real workflows — research, outreach, operations, and support — wired into the tools you already run.",
  },
];

export function Services() {
  return (
    <section id="services" className="border-t border-line bg-surface">
      <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold tracking-wide text-brand uppercase">
            What we do
          </p>
          {/* Names the problem, not the technology. "The AI layer your business runs on" is a
              sentence a contractor has no use for; a missed call is one he can price. */}
          <h2 className="mt-3 text-4xl font-extrabold tracking-tight md:text-5xl">
            The calls you miss are someone else&apos;s jobs.
          </h2>
        </div>

        <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-2">
          {services.map((s, i) => (
            <div
              key={s.title}
              className="group relative bg-background p-8 transition-colors hover:bg-brand-tint md:p-10"
            >
              <span className="text-sm font-bold text-brand">
                0{i + 1}
              </span>
              <h3 className="mt-4 text-2xl font-bold tracking-tight">
                {s.title}
              </h3>
              <p className="mt-3 leading-relaxed text-ink-soft">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
