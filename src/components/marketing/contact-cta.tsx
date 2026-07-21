import Link from "next/link";

import { ContactStatus } from "./contact-status";

const CONTACT_EMAIL = "joe@thinkbigjoe.com";
const CONTACT_PHONE = "(480) 764-2121";
const CONTACT_PHONE_HREF = "tel:+14807642121";

export function ContactCTA() {
  return (
    <section id="contact" className="border-t border-line bg-ink text-white">
      <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
        {/* Phone is the hero of this section — the fastest path to a booked job is a live call
            with the AI receptionist, so the number leads and the form is the fallback. */}
        <div className="flex flex-col items-center text-center">
          <p className="text-sm font-semibold tracking-wide text-brand uppercase">
            Get in touch
          </p>
          <h2 className="mt-3 max-w-3xl text-4xl font-extrabold leading-tight tracking-tight md:text-5xl">
            Got questions? Let&apos;s talk Ai.
          </h2>
          <p className="mt-6 max-w-xl leading-relaxed text-white/60">
            Call our AI receptionist any time — it answers 24/7 and can walk you
            through getting set up.
          </p>

          <a
            href={CONTACT_PHONE_HREF}
            className="mt-10 inline-flex items-center gap-3 rounded-full bg-brand px-8 py-5 text-2xl font-extrabold tracking-tight text-white transition-colors hover:bg-brand-dark md:px-12 md:py-6 md:text-4xl"
          >
            <svg viewBox="0 0 24 24" className="h-7 w-7 md:h-9 md:w-9" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012 4.2 2 2 0 014 2h3a2 2 0 012 1.7c.1.9.4 1.8.7 2.7a2 2 0 01-.5 2.1L8.1 9.9a16 16 0 006 6l1.4-1.1a2 2 0 012.1-.5c.9.3 1.8.6 2.7.7a2 2 0 011.7 2z" />
            </svg>
            {CONTACT_PHONE}
          </a>
          <p className="mt-4 text-sm text-white/50">Answers 24/7 · No wait</p>
        </div>

        {/* Secondary: prefer to write? The contact form → emails Joe + captures as a lead. */}
        <div className="mx-auto mt-16 max-w-xl border-t border-white/10 pt-12">
          <div className="text-center">
            <p className="text-sm font-semibold text-white">Prefer to write?</p>
            <p className="mt-1 text-sm text-white/60">
              Send a note and our team gets back to you, usually within a day — or
              email{" "}
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="font-medium text-white underline decoration-white/30 underline-offset-4 hover:decoration-white"
              >
                {CONTACT_EMAIL}
              </a>
              .
            </p>
          </div>

          <div className="mt-6">
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
