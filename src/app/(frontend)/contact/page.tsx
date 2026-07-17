import type { Metadata } from "next";

import { SiteNav } from "@/components/marketing/site-nav";
import { SiteFooter } from "@/components/marketing/site-footer";
import { BUSINESS } from "@/lib/business";

export const metadata: Metadata = {
  title: "Contact",
  description: `Get in touch with ${BUSINESS.brand} — email, phone, or send us a message.`,
};

export default async function ContactPage({ searchParams }: { searchParams: Promise<{ sent?: string; error?: string }> }) {
  const { sent, error } = await searchParams;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteNav />
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16">
        <h1 className="text-4xl font-extrabold tracking-tight">Contact us</h1>
        <p className="mt-3 leading-relaxed text-ink-soft">
          Questions about a website, the AI receptionist, or anything else? Reach out — we usually reply the same day.
        </p>

        <div className="mt-6 grid gap-3 rounded-2xl border border-line bg-surface p-5 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Email</p>
            <a href={`mailto:${BUSINESS.email}`} className="mt-1 block font-semibold text-brand hover:underline">{BUSINESS.email}</a>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Phone</p>
            <a href={`tel:${BUSINESS.phoneHref}`} className="mt-1 block font-semibold text-brand hover:underline">{BUSINESS.phone}</a>
          </div>
          <div className="sm:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Business</p>
            <p className="mt-1 text-sm text-ink">{BUSINESS.dba} · {BUSINESS.address}</p>
          </div>
        </div>

        {sent && (
          <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            Thanks — your message is in. We&apos;ll be in touch shortly.
          </div>
        )}
        {error && (
          <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Please fill in your name, a valid email, and a message, then try again.
          </div>
        )}

        <form action="/api/contact" method="post" className="mt-8 space-y-5">
          {/* Honeypot — hidden from humans, bots fill it. */}
          <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
          <input type="hidden" name="source_path" value="/contact" />

          <div className="grid gap-5 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-semibold text-ink">Name *</span>
              <input name="name" required className="mt-2 w-full rounded-xl border border-line bg-background px-3.5 py-2.5 text-sm text-ink focus:border-brand focus:outline-none" />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-ink">Phone</span>
              <input name="phone" type="tel" placeholder="(480) 555-1234" className="mt-2 w-full rounded-xl border border-line bg-background px-3.5 py-2.5 text-sm text-ink focus:border-brand focus:outline-none" />
            </label>
          </div>
          <label className="block">
            <span className="text-sm font-semibold text-ink">Email *</span>
            <input name="email" type="email" required className="mt-2 w-full rounded-xl border border-line bg-background px-3.5 py-2.5 text-sm text-ink focus:border-brand focus:outline-none" />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-ink">Message *</span>
            <textarea name="message" rows={4} required className="mt-2 w-full rounded-xl border border-line bg-background px-3.5 py-2.5 text-sm text-ink focus:border-brand focus:outline-none" />
          </label>

          {/* Explicit, itemized consent — the A2P 10DLC opt-in record. */}
          <fieldset className="space-y-3 rounded-xl border border-line bg-surface p-4">
            <legend className="px-1 text-sm font-semibold text-ink">How can we reach you?</legend>

            <label className="flex items-start gap-3 text-sm text-ink-soft">
              <input type="checkbox" name="sms_transactional" value="yes" className="mt-0.5 h-4 w-4 rounded border-line text-brand focus:ring-brand" />
              <span>
                <span className="font-medium text-ink">Text me service updates.</span> I agree to receive non-marketing text
                messages from {BUSINESS.brand} at the number provided — appointment confirmations, reminders, preview/claim
                links, and follow-ups.
              </span>
            </label>

            <label className="flex items-start gap-3 text-sm text-ink-soft">
              <input type="checkbox" name="sms_marketing" value="yes" className="mt-0.5 h-4 w-4 rounded border-line text-brand focus:ring-brand" />
              <span>
                <span className="font-medium text-ink">Text me offers.</span> I agree to receive marketing/promotional text
                messages from {BUSINESS.brand} at the number provided.
              </span>
            </label>

            <label className="flex items-start gap-3 text-sm text-ink-soft">
              <input type="checkbox" name="email_consent" value="yes" className="mt-0.5 h-4 w-4 rounded border-line text-brand focus:ring-brand" />
              <span><span className="font-medium text-ink">Email me.</span> I agree to receive emails from {BUSINESS.brand}.</span>
            </label>

            <p className="pt-1 text-xs leading-relaxed text-ink-soft">
              Message and data rates may apply. Message frequency varies. Reply <span className="font-mono font-semibold text-ink">STOP</span> to
              opt out or <span className="font-mono font-semibold text-ink">HELP</span> for help. Consent to receive text
              messages is not a condition of any purchase. See our{" "}
              <a href="/terms-of-service" className="font-semibold text-brand hover:underline">Terms of Service</a> and{" "}
              <a href="/privacy-policy" className="font-semibold text-brand hover:underline">Privacy Policy</a>. We never share
              or sell your mobile opt-in or SMS consent to third parties.
            </p>
          </fieldset>

          <button type="submit" className="inline-flex items-center justify-center rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-dark">
            Send message
          </button>
        </form>
      </main>
      <SiteFooter />
    </div>
  );
}
