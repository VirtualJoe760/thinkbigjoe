import Image from "next/image";
import Link from "next/link";

const PILLARS = [
  {
    title: "Senior & hands-on",
    body: "You work directly with the engineers who build your system — no account managers in between.",
  },
  {
    title: "Embedded, not bolted on",
    body: "Agents wired into your CRM, ERP, or DMS through MCP — automation inside the tools you already run.",
  },
  {
    title: "Production-grade",
    body: "We ship systems that run the work and maintain them as you grow — not pilots that get abandoned.",
  },
];

export function Founder() {
  return (
    <section id="about" className="border-t border-line bg-surface">
      <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
        <div className="grid items-start gap-12 md:grid-cols-[1.4fr_1fr] md:gap-16">
          {/* Positioning */}
          <div>
            <p className="text-sm font-semibold tracking-wide text-brand uppercase">
              The studio
            </p>
            <h2 className="mt-3 text-4xl font-extrabold leading-[1.05] tracking-tight text-balance md:text-5xl">
              A specialist AI studio, built around your business.
            </h2>
            <div className="mt-6 max-w-xl space-y-4 text-lg leading-relaxed text-ink-soft">
              <p>
                ThinkBigJoe designs, builds, and maintains agentic software and
                Model Context Protocol (MCP) integrations — custom AI that runs
                real workflows end to end, not demos or dashboards you have to
                babysit.
              </p>
              <p>
                Every engagement is led by the people who actually build it. You
                get senior engineering, a clear plan, and systems that fit how
                your business already runs.
              </p>
            </div>

            <div className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-3">
              {PILLARS.map((p) => (
                <div key={p.title} className="bg-background p-5">
                  <h3 className="text-sm font-bold tracking-tight">{p.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                    {p.body}
                  </p>
                </div>
              ))}
            </div>

            <Link
              href="/book-appointment"
              className="mt-10 inline-flex items-center justify-center rounded-full bg-brand px-7 py-3.5 text-base font-semibold text-white transition-colors hover:bg-brand-dark"
            >
              Book a strategy call
            </Link>
          </div>

          {/* Founder credential card */}
          <div className="md:pt-2">
            <div className="group relative mx-auto w-full max-w-xs overflow-hidden rounded-3xl border border-line bg-ink">
              <Image
                src="/joseph-headshot.png"
                alt="Joseph Sardella, founder of ThinkBigJoe"
                width={713}
                height={859}
                priority
                className="h-auto w-full object-cover grayscale transition duration-500 group-hover:grayscale-0"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink via-ink/70 to-transparent p-5 pt-12">
                <p className="text-base font-semibold text-white">
                  Joseph Sardella
                </p>
                <p className="text-sm text-white/70">
                  Founder &amp; Principal Engineer
                </p>
              </div>
            </div>
            <p className="mx-auto mt-4 max-w-xs text-center text-sm leading-relaxed text-ink-soft">
              Full-stack and agentic-AI engineer who ships the work himself —
              with an operator&apos;s view of how businesses actually run.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
