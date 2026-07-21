import { IVY_PHONE_PRETTY, IVY_PHONE_HREF } from "@/lib/contact";

/**
 * "Call Ivy about X" — the one panel the portal uses everywhere setup used to be a form.
 *
 * The sales model is voice-first: you don't fill in a form to get a receptionist, a website, or a
 * custom agent — you call Ivy and tell her, and she takes it from there. So this single component
 * replaces the receptionist setup form, the build-a-site form, and the agents entry. Built once,
 * reused, so all three read identically.
 *
 * Zero-JS: it's a tel: link and static copy. A contractor on bad LTE taps the number; nothing to
 * hydrate. On desktop the number is still selectable/dialable, and shown large because it IS the CTA.
 */
export function CallIvy({
  heading,
  blurb,
  steps,
  compact = false,
}: {
  heading: string;
  blurb: string;
  /** 2–4 short "here's what happens when you call" lines. Keep them concrete. */
  steps?: string[];
  /** compact = a header strip above other content (the "make changes" case), not a full panel. */
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold text-ink">{heading}</p>
          <p className="mt-0.5 text-sm text-ink-soft">{blurb}</p>
        </div>
        <a
          href={IVY_PHONE_HREF}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-brand px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-dark"
        >
          <span aria-hidden>📞</span> Call {IVY_PHONE_PRETTY}
        </a>
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-line bg-surface p-6 sm:p-8">
      <p className="text-4xl" aria-hidden>
        📞
      </p>
      <h2 className="mt-4 text-2xl font-extrabold tracking-tight text-ink">{heading}</h2>
      <p className="mt-2 max-w-md leading-relaxed text-ink-soft">{blurb}</p>

      <a
        href={IVY_PHONE_HREF}
        className="mt-6 inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-brand px-7 text-lg font-bold text-white transition-colors hover:bg-brand-dark"
      >
        Call {IVY_PHONE_PRETTY}
      </a>
      <p className="mt-2 text-sm text-ink-soft">
        Ivy&apos;s our AI assistant — she answers 24/7 and takes about 5 minutes.
      </p>

      {steps && steps.length > 0 && (
        <ol className="mt-6 space-y-2 border-t border-line pt-5">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-3 text-sm text-ink-soft">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-tint text-xs font-bold text-brand">
                {i + 1}
              </span>
              {s}
            </li>
          ))}
        </ol>
      )}

      <p className="mt-5 text-xs text-ink-soft">
        Prefer to have us call you, or want to book time with Joe instead?{" "}
        <a href="/portal/book" className="font-semibold text-brand hover:underline">
          Book a call
        </a>
        .
      </p>
    </section>
  );
}
