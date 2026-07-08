"use client";

import { useActionState } from "react";

import { saveReceptionistSetup, type ReceptionistState } from "../../actions";

export type ReceptionistConfig = {
  services?: string; hours?: string; greeting?: string; booking?: string;
  forwardTo?: string; faqs?: string; doNot?: string;
};

const initial: ReceptionistState = { ok: false, message: "" };

function Field({ label, name, hint, defaultValue, placeholder, rows = 3 }: {
  label: string; name: string; hint?: string; defaultValue?: string; placeholder?: string; rows?: number;
}) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-ink">{label}</span>
      {hint && <span className="mt-0.5 block text-xs text-ink-soft">{hint}</span>}
      <textarea
        name={name} rows={rows} defaultValue={defaultValue} placeholder={placeholder}
        className="mt-2 w-full rounded-xl border border-line bg-background px-3.5 py-2.5 text-sm leading-relaxed text-ink focus:border-brand focus:outline-none"
      />
    </label>
  );
}

export function ReceptionistForm({
  siteId, businessName, config, status,
}: {
  siteId: number; businessName: string; config: ReceptionistConfig; status: string;
}) {
  const [state, action, pending] = useActionState(saveReceptionistSetup, initial);

  const submitted = status === "submitted" || status === "active";

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="siteId" value={siteId} />

      {submitted && !state.ok && (
        <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm text-violet-800">
          {status === "active"
            ? "✅ Your receptionist is active. Update anything below and save to send changes."
            : "⏳ Setup submitted — our team is provisioning your receptionist. You can still edit and re-save."}
        </div>
      )}

      <Field
        label="What does your business do?" name="services" rows={3}
        hint="Your services, specialties, service area — so the AI can answer basic questions."
        defaultValue={config.services}
        placeholder="e.g. Residential & commercial roofing across the Phoenix metro — repairs, replacements, and free inspections."
      />
      <Field
        label="How should it greet callers?" name="greeting" rows={2}
        hint="The first line callers hear."
        defaultValue={config.greeting}
        placeholder={`e.g. "Thanks for calling ${businessName}! How can I help?"`}
      />
      <Field
        label="Business hours" name="hours" rows={2}
        hint="When you're open — and what the AI should say after hours."
        defaultValue={config.hours}
        placeholder="e.g. Mon–Fri 7am–5pm. After hours: take a message and we'll call back next morning."
      />
      <Field
        label="Booking & appointments" name="booking" rows={2}
        hint="Should the AI book jobs? If so, how — a calendar link, or take details for a callback?"
        defaultValue={config.booking}
        placeholder="e.g. Book estimates into my Google Calendar; anything urgent, text me right away."
      />
      <Field
        label="Where should it send messages / urgent calls?" name="forwardTo" rows={1}
        hint="A phone number or email for messages and anything the AI can't handle."
        defaultValue={config.forwardTo}
        placeholder="e.g. text 480-555-1234, or email owner@business.com"
      />
      <Field
        label="Common questions & answers" name="faqs" rows={4}
        hint="The things people always ask — pricing ranges, do you offer X, warranty, etc."
        defaultValue={config.faqs}
        placeholder={"e.g.\nDo you give free estimates? — Yes, always free.\nAre you licensed & insured? — Yes, license #..."}
      />
      <Field
        label="Anything it should NOT do?" name="doNot" rows={2}
        hint="Guardrails — e.g. never quote a firm price, never promise same-day."
        defaultValue={config.doNot}
        placeholder="e.g. Don't give exact prices over the phone; don't promise timelines — I confirm those."
      />

      {state.message && (
        <p className={`text-sm font-medium ${state.ok ? "text-emerald-700" : "text-red-600"}`}>{state.message}</p>
      )}

      <button
        type="submit" disabled={pending}
        className="inline-flex items-center justify-center rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-50"
      >
        {pending ? "Saving…" : submitted ? "Save changes" : "Submit setup"}
      </button>
    </form>
  );
}
