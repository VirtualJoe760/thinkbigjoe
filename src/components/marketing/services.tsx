/*
 * WHAT WE BUILD (2026-10-26 repositioning). The site used to sell the voice receptionist first and
 * the website as a freebie. Joe's call: we sell the WHOLE solution — a website sized to the
 * business (simple → enterprise-grade) with AI agents built in, voice being one of them. Order:
 * the website, the bigger systems, then the AI that runs inside them, then the support.
 * Plain words only — no "agentic", "integrations", acronyms.
 */
import type { ReactNode } from "react";

type IconProps = { className?: string };

const svg = (paths: ReactNode) => (props: IconProps) => (
  <svg
    viewBox="0 0 24 24"
    className={props.className}
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

const PhoneIcon = svg(
  <path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012 4.2 2 2 0 014 2h3a2 2 0 012 1.7c.1.9.4 1.8.7 2.7a2 2 0 01-.5 2.1L8.1 9.9a16 16 0 006 6l1.4-1.1a2 2 0 012.1-.5c.9.3 1.8.6 2.7.7a2 2 0 011.7 2z" />,
);
const GlobeIcon = svg(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a15 15 0 010 18 15 15 0 010-18z" />
  </>,
);
const RepeatIcon = svg(
  <>
    <path d="M17 2l4 4-4 4" />
    <path d="M3 11V9a4 4 0 014-4h14" />
    <path d="M7 22l-4-4 4-4" />
    <path d="M21 13v2a4 4 0 01-4 4H3" />
  </>,
);
const ChartIcon = svg(
  <>
    <path d="M3 3v18h18" />
    <path d="M7 15l4-4 3 3 5-6" />
  </>,
);

const LayersIcon = svg(
  <>
    <path d="M12 2L2 7l10 5 10-5-10-5z" />
    <path d="M2 17l10 5 10-5M2 12l10 5 10-5" />
  </>,
);
const BotIcon = svg(
  <>
    <rect x="4" y="8" width="16" height="12" rx="2" />
    <path d="M12 4v4M9 13h.01M15 13h.01M9 17h6" />
  </>,
);

const services = [
  {
    icon: GlobeIcon,
    title: "Websites that win work",
    body: "A fast, good-looking website that works great on a phone and makes it easy to call, book or ask for a quote. Perfect for getting started or replacing an old site.",
  },
  {
    icon: LayersIcon,
    title: "Custom systems as you grow",
    body: "Customer logins, job tracking, online booking, payments and dashboards for your team. Built for one truck or fifty, and it grows with you.",
  },
  {
    icon: BotIcon,
    title: "AI that does the busywork",
    body: "AI helpers built into your site that follow up on quotes, ask for reviews, answer customer questions and remind past customers when it's time for service.",
  },
  {
    icon: PhoneIcon,
    title: "AI that answers your phone",
    body: "When you can't pick up, our AI receptionist does — day or night. It finds out what the job is and texts you the details.",
  },
  {
    icon: ChartIcon,
    title: "See your business in one place",
    body: "Calls, leads, booked jobs and reviews on one simple page you can check from your phone.",
  },
  {
    icon: RepeatIcon,
    title: "We run it for you",
    body: "Hosting, updates, fixes and new features. No tech skills needed — just tell us what you want changed.",
  },
];

export function Services() {
  return (
    <section id="services" className="border-t border-line bg-surface">
      <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold tracking-wide text-brand uppercase">
            What we build
          </p>
          <h2 className="mt-3 text-4xl font-extrabold tracking-tight md:text-5xl">
            One team for your website, your systems and your AI.
          </h2>
        </div>

        <div className="mt-14 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.title} className="flex flex-col">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-brand-tint text-brand">
                  <Icon className="h-5 w-5" />
                </span>
                <h3 className="mt-5 text-lg font-bold tracking-tight">
                  {s.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                  {s.body}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
