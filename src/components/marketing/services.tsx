/*
 * ORDER IS THE MESSAGE. This list used to open with "Websites That Convert" and run eight
 * co-equal services, which read as "we do a bit of everything" — the least persuasive thing an
 * agency can say, and it buried the receptionist at position two.
 *
 * The phone is what a contractor is actually losing money on, so it goes first and gets the most
 * space. The website stays in the offer (it costs us almost nothing and every voice-only
 * competitor charges more for the phone alone) but it is now the thing that comes WITH the
 * receptionist rather than the headline act.
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
const MoonIcon = svg(<path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />);
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
const SunIcon = svg(
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </>,
);
const ChartIcon = svg(
  <>
    <path d="M3 3v18h18" />
    <path d="M7 15l4-4 3 3 5-6" />
  </>,
);

// Plain language for the owner (2026-10-26). No "agentic", no "integrations", no acronyms.
// Each card = a problem they have + what we do about it, in their words.
const services = [
  {
    icon: PhoneIcon,
    title: "We answer when you can't",
    body: "Our AI receptionist picks up every call you miss. It finds out what the job is, where it is and how soon they need you — then texts it all to you. No more voicemails nobody calls back.",
  },
  {
    icon: SunIcon,
    title: "Ready for the busy season",
    body: "When it's 115° and every AC in the valley quits at once, the phone doesn't stop ringing. We answer all of it, so those jobs don't go to the next company on the list.",
  },
  {
    icon: MoonIcon,
    title: "Nights and weekends covered",
    body: "Your phone rings first, like it always has. We only pick up the calls you'd miss — after hours, on the weekend, or when your hands are full.",
  },
  {
    icon: GlobeIcon,
    title: "A website that brings in calls",
    body: "A clean, fast website that looks great on a phone. We build it, host it and keep it updated. You don't need to know anything about websites.",
  },
  {
    icon: RepeatIcon,
    title: "Follow-ups done for you",
    body: "We remind customers about quotes they haven't said yes to, ask happy customers for a review, and check in with past customers when it's time for service again.",
  },
  {
    icon: ChartIcon,
    title: "See it all in one place",
    body: "Every call we answered and every job we booked, in one simple page you can check from your phone.",
  },
];

export function Services() {
  return (
    <section id="services" className="border-t border-line bg-surface">
      <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold tracking-wide text-brand uppercase">
            What you get
          </p>
          <h2 className="mt-3 text-4xl font-extrabold tracking-tight md:text-5xl">
            Less time on the phone. More time on the job.
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
