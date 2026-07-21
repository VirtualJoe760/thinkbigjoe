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
const LinkIcon = svg(
  <>
    <path d="M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.7 1.7" />
    <path d="M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.7-1.7" />
  </>,
);
const BoltIcon = svg(<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />);

const services = [
  {
    icon: PhoneIcon,
    title: "AI Receptionist",
    body: "Answers every call 24/7 in your business's voice — finds out what the job is, how urgent it is, and where, then texts you the details straight away. The 7pm burst pipe stops going to whoever picks up first.",
  },
  {
    icon: MoonIcon,
    title: "Never Miss After Hours",
    body: "Your phone rings first. We only pick up the calls you'd have lost — nights, weekends, when you're under a sink. You keep every call you can actually take.",
  },
  {
    icon: GlobeIcon,
    title: "Your Website, Included",
    body: "A fast, modern site built, hosted and maintained for you. It comes with the receptionist rather than costing extra, and it's where you see every call the AI answered.",
  },
  {
    icon: RepeatIcon,
    title: "Follow-Up That Actually Happens",
    body: "Quotes chased, dormant customers reactivated, reviews requested after the job. The work that makes money and never gets done because everyone's on a truck.",
  },
  {
    icon: LinkIcon,
    title: "Custom AI Integrations",
    body: "Secure, permissioned connections that give your AI structured access to the data and systems you already run — the connective tissue between AI and your business.",
  },
  {
    icon: BoltIcon,
    title: "Agentic Software",
    body: "Autonomous agents that handle real workflows — research, outreach, operations, and support — wired into the tools you already run.",
  },
];

export function Services() {
  return (
    <section id="services" className="border-t border-line bg-surface">
      <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold tracking-wide text-brand uppercase">
            What we do
          </p>
          <h2 className="mt-3 text-4xl font-extrabold tracking-tight md:text-5xl">
            Delight your customers across every interaction.
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
