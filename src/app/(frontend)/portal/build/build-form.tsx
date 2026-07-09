"use client";

import { useActionState } from "react";

import { requestSiteBuild, type BuildState } from "../actions";

const initial: BuildState = { ok: false, message: "" };

function Field({ label, name, placeholder, required, defaultValue, type = "text" }: {
  label: string; name: string; placeholder?: string; required?: boolean; defaultValue?: string; type?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-ink">{label}{required && <span className="text-brand"> *</span>}</span>
      <input
        name={name} type={type} placeholder={placeholder} defaultValue={defaultValue}
        className="mt-2 w-full rounded-xl border border-line bg-background px-3.5 py-2.5 text-sm text-ink focus:border-brand focus:outline-none"
      />
    </label>
  );
}

export function BuildForm({ defaultEmail }: { defaultEmail: string }) {
  const [state, action, pending] = useActionState(requestSiteBuild, initial);

  if (state.ok) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
        <p className="text-lg font-bold text-emerald-900">We&apos;re on it 🛠️</p>
        <p className="mt-2 text-sm leading-relaxed text-emerald-800">{state.message}</p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-5">
      <Field label="Business name" name="businessName" placeholder="e.g. Summit Ridge Roofing" required />
      <Field label="What do you do?" name="niche" placeholder="e.g. Roofing · Plumbing · Landscaping" required />
      <Field label="City / service area" name="city" placeholder="e.g. Phoenix, AZ" />
      <Field label="Phone" name="phone" type="tel" placeholder="(480) 555-1234" />
      <Field label="Contact email" name="email" type="email" placeholder={defaultEmail} defaultValue={defaultEmail} />
      <label className="block">
        <span className="text-sm font-semibold text-ink">Brand color <span className="font-normal text-ink-soft">(optional)</span></span>
        <input name="brandColor" type="text" placeholder="#2f6bff or 'navy blue'"
          className="mt-2 w-full rounded-xl border border-line bg-background px-3.5 py-2.5 text-sm text-ink focus:border-brand focus:outline-none" />
      </label>

      {state.message && !state.ok && <p className="text-sm font-medium text-red-600">{state.message}</p>}

      <button type="submit" disabled={pending}
        className="inline-flex items-center justify-center rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-50">
        {pending ? "Queuing your build…" : "Build my site"}
      </button>
      <p className="text-xs text-ink-soft">Free to try for 7 days — subscribe when you&apos;re ready to keep editing and take it live.</p>
    </form>
  );
}
