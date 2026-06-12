export function ContactCTA() {
  return (
    <section id="contact" className="border-t border-line bg-ink text-white">
      <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-20">
          <div>
            <p className="text-sm font-semibold tracking-wide text-brand uppercase">
              Let&apos;s talk
            </p>
            <h2 className="mt-3 text-4xl font-extrabold leading-tight tracking-tight md:text-5xl">
              Tell us where you want to go.
            </h2>
            <p className="mt-6 max-w-md leading-relaxed text-white/60">
              Book a free strategy call and we&apos;ll map the highest-leverage
              AI opportunities in your business — no pitch, just a plan.
            </p>
          </div>

          {/* Lead capture → stores a Lead and unlocks the booking calendar */}
          <form className="space-y-4" action="/api/lead" method="post">
            {/* Honeypot — hidden from humans, bots fill it */}
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              className="hidden"
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field name="name" label="Name" placeholder="Jane Doe" />
              <Field
                name="email"
                type="email"
                label="Work email"
                placeholder="jane@company.com"
              />
            </div>
            <Field name="company" label="Company" placeholder="Acme Inc." />
            <div>
              <label
                htmlFor="message"
                className="mb-1.5 block text-sm font-medium text-white/70"
              >
                What are you trying to build?
              </label>
              <textarea
                id="message"
                name="message"
                rows={4}
                placeholder="We want agents that handle inbound leads…"
                className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-white placeholder:text-white/30 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
              />
            </div>
            <button
              type="submit"
              className="w-full rounded-full bg-brand px-6 py-3.5 text-base font-semibold text-white transition-colors hover:bg-brand-dark sm:w-auto"
            >
              Book my strategy call
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}

function Field({
  name,
  label,
  placeholder,
  type = "text",
}: {
  name: string;
  label: string;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label
        htmlFor={name}
        className="mb-1.5 block text-sm font-medium text-white/70"
      >
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        placeholder={placeholder}
        className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-white placeholder:text-white/30 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
      />
    </div>
  );
}
