const services = [
  {
    title: "Websites That Convert",
    body: "A fast, modern site custom-built for your business — designed to turn visitors into booked jobs. We build it, host it, and keep it running.",
  },
  {
    title: "AI Voice Receptionist",
    body: "An AI that answers every call in your business's voice, 24/7 — qualifies the caller, answers questions, and books the appointment straight to your calendar.",
  },
  {
    title: "AI Chat Widget",
    body: "A chat assistant on your site that answers questions the moment someone lands — capturing the lead before they bounce to a competitor.",
  },
  {
    title: "Agentic Software",
    body: "Autonomous agents that handle real workflows — research, outreach, operations, and support — wired into the tools you already run.",
  },
  {
    title: "MCP Development",
    body: "Custom Model Context Protocol servers that give AI secure, structured access to your data and systems. The connective tissue of modern AI.",
  },
  {
    title: "AI Sales System",
    body: "The full done-for-you engine: finds prospects, reaches out, follows up, and books calls — so your pipeline fills while you do the work you love.",
  },
  {
    title: "AI Sales Funnels",
    body: "Conversion-built landing pages and lead engines that qualify, nurture, and book — so your pipeline fills while you sleep.",
  },
  {
    title: "AI Strategy & Enablement",
    body: "A clear roadmap for where AI moves the needle in your business, plus the training to make your team dangerous with it.",
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
          <h2 className="mt-3 text-4xl font-extrabold tracking-tight md:text-5xl">
            We build the AI layer your business runs on.
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
