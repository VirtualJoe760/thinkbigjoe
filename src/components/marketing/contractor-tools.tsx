/*
 * Contractor tools (2026-10-26) — website add-ons pitched to Coachella Valley home service
 * businesses. ⚠️ None of these exist as a ready-made product yet: each is a custom build added to
 * a client's site. The section says "built for your business" on purpose, so it does not claim an
 * off-the-shelf feature. Build notes + effort for each: docs/CONTRACTOR_TOOLS.md.
 */
import type { ReactNode } from "react";

const icon = (paths: ReactNode) => (
  <svg
    viewBox="0 0 24 24"
    className="h-5 w-5"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    {paths}
  </svg>
);

const tools = [
  {
    icon: icon(
      <>
        <rect x="4" y="2" width="16" height="20" rx="2" />
        <path d="M8 6h8M8 10h2M14 10h2M8 14h2M14 14h2M8 18h2M14 18h2" />
      </>,
    ),
    title: "Instant estimate calculator",
    body: "Customers enter a few basics — roof size, square footage, number of bathrooms — and get a ballpark price on the spot. You get a lead who already knows your range.",
  },
  {
    icon: icon(
      <>
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
      </>,
    ),
    title: "Job status for your customers",
    body: "Each customer gets a private login to see where their job stands — scheduled, in progress, done — with photos. Far fewer “when are you coming?” calls.",
  },
  {
    icon: icon(
      <>
        <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
        <circle cx="12" cy="13" r="4" />
      </>,
    ),
    title: "Send a photo, get a quote",
    body: "Customers snap a picture of the leak, the cracked tile or the broken unit and send it with their request. You quote faster and show up with the right parts.",
  },
  {
    icon: icon(
      <>
        <rect x="1" y="4" width="22" height="16" rx="2" />
        <path d="M1 10h22" />
      </>,
    ),
    title: "Get paid by text",
    body: "Send an invoice to the customer's phone and they pay by card in a couple of taps. No more chasing checks.",
  },
  {
    icon: icon(
      <>
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
      </>,
    ),
    title: "Service reminders",
    body: "Automatic reminders for spring AC tune-ups, roof checks before monsoon season, and yearly maintenance. Steady work, even in the slow months.",
  },
  {
    icon: icon(
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="M21 15l-5-5L5 21" />
      </>,
    ),
    title: "Before-and-after gallery",
    body: "Show off your best kitchens, roofs and remodels. Upload photos from your phone and they appear on your site.",
  },
];

export function ContractorTools() {
  return (
    <section id="tools" className="border-t border-line">
      <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold tracking-wide text-brand uppercase">
            Tools for your website
          </p>
          <h2 className="mt-3 text-4xl font-extrabold tracking-tight md:text-5xl">
            Tools that win you more jobs.
          </h2>
          <p className="mt-6 leading-relaxed text-ink-soft">
            Add any of these to your website. We build them for your business,
            so your customers get answers faster and you spend less time on the
            phone.
          </p>
        </div>

        <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((t) => (
            <div key={t.title} className="flex flex-col bg-background p-8">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-brand-tint text-brand">
                {t.icon}
              </span>
              <h3 className="mt-5 text-lg font-bold tracking-tight">{t.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">{t.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
