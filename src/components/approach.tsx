const steps = [
  {
    n: "01",
    title: "Think big",
    body: "We start with the ambition, not the tooling. Where could AI take your business if nothing held it back? That vision sets the brief.",
  },
  {
    n: "02",
    title: "Design the system",
    body: "We map the agents, the data, and the MCP connections — architecting a solution that fits how you actually operate.",
  },
  {
    n: "03",
    title: "Build & ship",
    body: "Custom software, shipped fast and iterated in the open. You see progress in real time through your client portal.",
  },
  {
    n: "04",
    title: "Scale what works",
    body: "We measure, refine, and expand the wins — turning a single agent into an operating system for your growth.",
  },
];

export function Approach() {
  return (
    <section id="approach">
      <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
        <div className="grid gap-16 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="lg:sticky lg:top-28 lg:self-start">
            <p className="text-sm font-semibold tracking-wide text-brand uppercase">
              The approach
            </p>
            <h2 className="mt-3 text-4xl font-extrabold leading-tight tracking-tight md:text-5xl">
              Think different.
              <br />
              Then think{" "}
              <span className="text-brand">bigger.</span>
            </h2>
            <p className="mt-6 max-w-md leading-relaxed text-ink-soft">
              Most agencies bolt AI onto what already exists. We rethink the
              whole machine — and build the version of your business that AI
              makes possible.
            </p>
          </div>

          <ol className="space-y-px overflow-hidden rounded-2xl border border-line bg-line">
            {steps.map((s) => (
              <li
                key={s.n}
                className="flex gap-6 bg-background p-8 md:p-10"
              >
                <span className="text-2xl font-extrabold tabular-nums text-brand">
                  {s.n}
                </span>
                <div>
                  <h3 className="text-xl font-bold tracking-tight">
                    {s.title}
                  </h3>
                  <p className="mt-2 leading-relaxed text-ink-soft">
                    {s.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
