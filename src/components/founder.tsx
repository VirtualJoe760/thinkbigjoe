import Image from "next/image";
import Link from "next/link";

export function Founder() {
  return (
    <section id="about" className="border-t border-line bg-surface">
      <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
        <div className="grid items-center gap-12 md:grid-cols-2 md:gap-16">
          <div className="order-2 md:order-1">
            <p className="text-sm font-semibold tracking-wide text-brand uppercase">
              Who you work with
            </p>
            <h2 className="mt-3 text-4xl font-extrabold tracking-tight md:text-5xl">
              Meet Joe.
            </h2>
            <div className="mt-6 space-y-4 text-lg leading-relaxed text-ink-soft">
              <p>
                I started ThinkBigJoe to help businesses do more than dabble
                with AI — to actually put it to work. I design and build the
                agentic systems and MCP integrations that automate real
                workflows, end to end.
              </p>
              <p>
                You work directly with me, not a layer of account managers.
                That means a clear plan, fast iteration, and software built to
                fit how your business actually runs.
              </p>
            </div>
            <Link
              href="/book-appointment"
              className="mt-8 inline-flex items-center justify-center rounded-full bg-brand px-7 py-3.5 text-base font-semibold text-white transition-colors hover:bg-brand-dark"
            >
              Book a strategy call
            </Link>
          </div>

          <div className="order-1 flex justify-center md:order-2">
            <div className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-line bg-background shadow-sm">
              <Image
                src="/joseph-headshot.png"
                alt="Joseph Sardella, founder of ThinkBigJoe"
                width={713}
                height={859}
                priority
                className="h-auto w-full object-cover"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
