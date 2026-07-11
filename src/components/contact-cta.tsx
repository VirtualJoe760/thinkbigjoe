import Link from "next/link";

import { ContactStatus } from "./contact-status";

const CONTACT_EMAIL = "joe@thinkbigjoe.com";
const CONTACT_PHONE = "(480) 764-2121";
const CONTACT_PHONE_HREF = "tel:+14807642121";

export function ContactCTA() {
  return (
    <section id="contact" className="border-t border-line bg-ink text-white">
      <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-20">
          <div>
            <p className="text-sm font-semibold tracking-wide text-brand uppercase">
              Get in touch
            </p>
            <h2 className="mt-3 text-4xl font-extrabold leading-tight tracking-tight md:text-5xl">
              Have a question? Send a note.
            </h2>
            <p className="mt-6 max-w-md leading-relaxed text-white/60">
              Send us a note and our team will get back to you, usually within a
              day. Or email us directly at{" "}
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="font-medium text-white underline decoration-white/30 underline-offset-4 hover:decoration-white"
              >
                {CONTACT_EMAIL}
              </a>
              .
            </p>
            <p className="mt-4 max-w-md leading-relaxed text-white/60">
              Prefer to talk? Call{" "}
              <a
                href={CONTACT_PHONE_HREF}
                className="font-medium text-white underline decoration-white/30 underline-offset-4 hover:decoration-white"
              >
                {CONTACT_PHONE}
              </a>{" "}
              — our AI assistant answers 24/7 and can book your call on the spot.
            </p>

            <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-5">
              <p className="text-sm font-semibold">Ready to dig in?</p>
              <p className="mt-1 text-sm text-white/60">
                A free 30-minute strategy call maps the highest-leverage AI in
                your business — no pitch, just a plan.
              </p>
              <Link
                href="/book-appointment"
                className="mt-4 inline-flex items-center justify-center rounded-full border border-white/20 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/10"
              >
                Book a strategy call →
              </Link>
            </div>
          </div>

          {/* Contact message → emails Joe + captures as a lead (no booking flow) */}
          <div>
            <ContactStatus />
            <form className="space-y-4" action="/api/contact" method="post">
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
                <Field name="name" label="Name" placeholder="Jane Doe" required />
                <Field
                  name="email"
                  type="email"
                  label="Email"
                  placeholder="jane@company.com"
                  required
                />
              </div>
              <div>
                <label
                  htmlFor="message"
                  className="mb-1.5 block text-sm font-medium text-white/70"
                >
                  Message
                </label>
                <textarea
                  id="message"
                  name="message"
                  rows={5}
                  required
                  placeholder="What's on your mind?"
                  className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-white placeholder:text-white/30 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
                />
              </div>
              <button
                type="submit"
                className="w-full rounded-full bg-brand px-6 py-3.5 text-base font-semibold text-white transition-colors hover:bg-brand-dark sm:w-auto"
              >
                Send message
              </button>
            </form>
          </div>
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
  required,
}: {
  name: string;
  label: string;
  placeholder?: string;
  type?: string;
  required?: boolean;
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
        required={required}
        placeholder={placeholder}
        className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-white placeholder:text-white/30 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
      />
    </div>
  );
}
