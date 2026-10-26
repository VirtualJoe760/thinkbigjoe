"use client";

import Link from "next/link";
import { useActionState } from "react";

import { requestSiteBuild, type BuildState } from "../actions";

/*
 * Business intake (2026-10-26). A new account fills this out instead of needing a claim code.
 * On submit: Joe gets an email + Telegram, the business lands in the CRM, and a build request is
 * queued for the forge (it waits while the forge is paused). See requestSiteBuild in ../actions.
 */

const initial: BuildState = { ok: false, message: "" };

const input =
  "mt-2 w-full rounded-xl border border-line bg-background px-3.5 py-2.5 text-sm text-ink focus:border-brand focus:outline-none";

const TRADES = [
  "General contractor",
  "Remodeling / renovation",
  "Roofing",
  "Tile / flooring",
  "Plumbing",
  "HVAC",
  "Electrical",
  "Landscaping / pools",
  "Other home service",
  "Other business",
];

const NEEDS = [
  { value: "website", label: "A new or better website" },
  { value: "phone", label: "AI to answer my calls" },
  { value: "followup", label: "Follow-ups, reviews & reminders" },
  { value: "custom", label: "A custom system (logins, job tracking, payments…)" },
  { value: "unsure", label: "Not sure yet — help me figure it out" },
];

function Field({ label, name, placeholder, required, defaultValue, type = "text" }: {
  label: string; name: string; placeholder?: string; required?: boolean; defaultValue?: string; type?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-ink">{label}{required && <span className="text-brand"> *</span>}</span>
      <input name={name} type={type} placeholder={placeholder} defaultValue={defaultValue} required={required} className={input} />
    </label>
  );
}

export function BuildForm({ defaultEmail, defaultName }: { defaultEmail: string; defaultName?: string }) {
  const [state, action, pending] = useActionState(requestSiteBuild, initial);

  if (state.ok) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
        <p className="text-lg font-bold text-emerald-900">Thanks — we&apos;ve got it 👍</p>
        <p className="mt-2 text-sm leading-relaxed text-emerald-800">{state.message}</p>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/portal/book"
            className="inline-flex items-center justify-center rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-dark"
          >
            Book a call with Joe
          </Link>
          <Link
            href="/portal"
            className="inline-flex items-center justify-center rounded-full border border-line bg-background px-6 py-3 text-sm font-semibold text-ink transition-colors hover:bg-surface"
          >
            Go to my portal
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-6">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Business name" name="businessName" placeholder="e.g. Desert Ridge Roofing" required />
        <label className="block">
          <span className="text-sm font-semibold text-ink">What kind of business?<span className="text-brand"> *</span></span>
          <select name="niche" required defaultValue="" className={input}>
            <option value="" disabled>Pick one</option>
            {TRADES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <Field label="City / area you serve" name="city" placeholder="e.g. Palm Desert" />
        <Field label="Business phone" name="phone" type="tel" placeholder="(760) 555-1234" required />
        <Field label="Your name" name="ownerName" defaultValue={defaultName} placeholder="First and last" />
        <Field label="Email" name="email" type="email" defaultValue={defaultEmail} placeholder={defaultEmail} />
      </div>

      <Field label="Current website (if you have one)" name="website" placeholder="yourbusiness.com — leave blank if none" />

      <fieldset>
        <legend className="text-sm font-semibold text-ink">What are you looking for?</legend>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {NEEDS.map((n) => (
            <label key={n.value} className="flex items-start gap-3 rounded-xl border border-line bg-background px-3.5 py-3 text-sm text-ink">
              <input type="checkbox" name="needs" value={n.label} className="mt-0.5 h-4 w-4 accent-[var(--brand)]" />
              <span>{n.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="block">
        <span className="text-sm font-semibold text-ink">Tell us about your business</span>
        <textarea
          name="details"
          rows={4}
          placeholder="What you do, who your customers are, and what's not working today (missed calls, no website, too much paperwork…)"
          className={input}
        />
      </label>

      <label className="block sm:max-w-xs">
        <span className="text-sm font-semibold text-ink">Best time to call you</span>
        <select name="bestTime" defaultValue="" className={input}>
          <option value="">Anytime</option>
          <option>Morning</option>
          <option>Midday</option>
          <option>Afternoon</option>
          <option>Evening</option>
        </select>
      </label>

      {state.message && !state.ok && <p className="text-sm font-medium text-red-600">{state.message}</p>}

      <button type="submit" disabled={pending}
        className="inline-flex w-full items-center justify-center rounded-full bg-brand px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-50 sm:w-auto">
        {pending ? "Sending…" : "Send my info"}
      </button>
      <p className="text-xs text-ink-soft">
        Joe reviews every request personally and will reach out. You can also book a call right after you send this.
      </p>
    </form>
  );
}
