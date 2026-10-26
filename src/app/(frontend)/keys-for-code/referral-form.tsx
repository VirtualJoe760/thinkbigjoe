"use client";

import { useState } from "react";

/*
 * Keys for Code intake form — DESIGN PREVIEW (2026-10-26).
 * ⚠️ Not wired yet: submitting shows a notice and sends nothing. The planned flow
 * (docs/KEYS_FOR_CODE.md): save to TBJ's DB → push the client to jpsrealtor.com's CRM as a new
 * referral contact → email/Telegram Joe → track the referral until escrow closes → credit.
 * Joe's realtor line (group-text hand-off): (760) 333-3676 — from jpsrealtor.com.
 */

const TRADES = [
  "General contractor",
  "Plumbing",
  "HVAC",
  "Roofing",
  "Remodeling",
  "Tile / flooring",
  "Electrical",
  "Landscaping / pools",
  "Solar",
  "Other",
];

const input =
  "w-full rounded-xl border border-line bg-background px-4 py-3 text-ink placeholder:text-ink-soft/60 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30";

function Field({
  label,
  name,
  type = "text",
  placeholder,
  required,
}: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink">
        {label}
        {required && <span className="text-brand"> *</span>}
      </span>
      <input name={name} type={type} placeholder={placeholder} required={required} className={input} />
    </label>
  );
}

export function ReferralForm() {
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <div className="rounded-2xl border border-brand bg-brand-tint/40 p-8 text-center">
        <p className="text-lg font-bold">Preview only — referrals open soon.</p>
        <p className="mt-2 text-sm text-ink-soft">
          This form isn&apos;t accepting referrals yet, so nothing was sent. Text
          or call Joe at{" "}
          <a href="tel:+17603333676" className="font-semibold text-ink underline">
            (760) 333-3676
          </a>{" "}
          if you have someone in mind today.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setSent(true);
      }}
      className="space-y-10 rounded-2xl border border-line bg-surface p-6 md:p-10"
    >
      <fieldset className="space-y-4">
        <legend className="text-lg font-bold tracking-tight">You</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Your name" name="referrerName" required placeholder="Mike Torres" />
          <Field label="Business name" name="businessName" required placeholder="Torres Roofing" />
          <Field label="Your phone" name="referrerPhone" type="tel" required placeholder="(760) 555-0123" />
          <Field label="Your email" name="referrerEmail" type="email" required placeholder="mike@torresroofing.com" />
        </div>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">
            Your trade<span className="text-brand"> *</span>
          </span>
          <select name="trade" required defaultValue="" className={input}>
            <option value="" disabled>
              Pick one
            </option>
            {TRADES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-lg font-bold tracking-tight">Your client</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Client's name" name="clientName" required placeholder="Sarah Nguyen" />
          <Field label="Client's phone" name="clientPhone" type="tel" required placeholder="(760) 555-0456" />
          <Field label="Client's email" name="clientEmail" type="email" placeholder="Optional" />
          <Field label="City or area" name="clientArea" placeholder="La Quinta" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink">
              They want to<span className="text-brand"> *</span>
            </span>
            <select name="intent" required defaultValue="" className={input}>
              <option value="" disabled>
                Pick one
              </option>
              <option>Buy a home</option>
              <option>Sell a home</option>
              <option>Buy and sell</option>
              <option>Not sure yet</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink">When?</span>
            <select name="timeframe" defaultValue="" className={input}>
              <option value="">Not sure</option>
              <option>Right away</option>
              <option>In 1–3 months</option>
              <option>In 3–6 months</option>
              <option>6+ months</option>
            </select>
          </label>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">Anything Joe should know?</span>
          <textarea
            name="notes"
            rows={4}
            placeholder="e.g. They're about to list after the kitchen remodel we're finishing."
            className={input}
          />
        </label>
      </fieldset>

      <div className="space-y-3 text-sm text-ink">
        <label className="flex items-start gap-3">
          <input type="checkbox" name="clientConsent" required className="mt-1 h-4 w-4 accent-[var(--brand)]" />
          <span>
            My client said it&apos;s okay for Joe Sardella to contact them about
            buying or selling a home.<span className="text-brand"> *</span>
          </span>
        </label>
        <label className="flex items-start gap-3">
          <input type="checkbox" name="notRepresented" required className="mt-1 h-4 w-4 accent-[var(--brand)]" />
          <span>
            As far as I know, my client isn&apos;t already working with another
            real estate agent.<span className="text-brand"> *</span>
          </span>
        </label>
      </div>

      <div>
        <button
          type="submit"
          className="w-full rounded-full bg-brand px-6 py-4 text-base font-semibold text-white transition-colors hover:bg-brand-dark"
        >
          Send referral
        </button>
        <p className="mt-3 text-center text-xs text-ink-soft">
          Next step after you send: start a group text with your client and Joe
          at (760) 333-3676.
        </p>
      </div>
    </form>
  );
}
