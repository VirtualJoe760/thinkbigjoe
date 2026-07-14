"use client";

import { useActionState } from "react";

import { saveContactAction } from "./actions";

type Values = {
  businessName: string;
  name: string;
  email: string;
  phone: string;
  address: string;
};

const FIELDS: { key: keyof Values; label: string; type?: string; placeholder?: string; full?: boolean }[] = [
  { key: "businessName", label: "Business name", full: true },
  { key: "name", label: "Owner name" },
  { key: "phone", label: "Phone", type: "tel" },
  { key: "email", label: "Email", type: "email", full: true },
  { key: "address", label: "Address", full: true, placeholder: "Street, city, state ZIP" },
];

export function ContactForm({ values, prefilledFromScrape }: { values: Values; prefilledFromScrape: boolean }) {
  const [state, action, pending] = useActionState(saveContactAction, null);

  return (
    <form action={action} className="rounded-2xl border border-line bg-surface p-6">
      <h3 className="text-lg font-bold tracking-tight">Business details</h3>
      <p className="mt-1 text-sm leading-relaxed text-ink-soft">
        {prefilledFromScrape
          ? "We filled these in from your public listing — please check them and fix anything that's off."
          : "Used across your site, bookings, and messages we send on your behalf."}
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <label key={f.key} className={`block ${f.full ? "sm:col-span-2" : ""}`}>
            <span className="text-sm font-semibold text-ink">{f.label}</span>
            <input
              name={f.key}
              type={f.type || "text"}
              defaultValue={values[f.key]}
              placeholder={f.placeholder}
              className="mt-1.5 w-full rounded-xl border border-line bg-background px-4 py-3 text-base text-ink outline-none focus:border-brand"
            />
          </label>
        ))}
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-brand px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save details"}
        </button>
        {state?.ok && <span className="text-sm font-medium text-emerald-700">✓ {state.message}</span>}
        {state && !state.ok && <span className="text-sm font-medium text-rose-600">{state.message}</span>}
      </div>
    </form>
  );
}
