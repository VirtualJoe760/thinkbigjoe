import Link from "next/link";
import { EVENTS, getContact } from "../_lib/data";
import { Avatar, Card, PageHeader } from "../_components/ui";

const KIND: Record<string, { label: string; cls: string }> = {
  walkthrough: { label: "Walkthrough", cls: "bg-brand-tint text-brand" },
  "check-in": { label: "Check-in", cls: "bg-emerald-50 text-emerald-600" },
  intro: { label: "Intro call", cls: "bg-amber-50 text-amber-600" },
};

export default function Calendar() {
  const byDay = EVENTS.reduce<Record<string, typeof EVENTS>>((acc, e) => {
    (acc[e.dayLabel] ||= []).push(e);
    return acc;
  }, {});

  return (
    <>
      <PageHeader title="Calendar" subtitle="Booked walkthroughs and client check-ins. Each call carries the Meeting strategist's brief." />

      <div className="flex flex-col gap-5">
        {Object.entries(byDay).map(([day, events]) => (
          <div key={day}>
            <p className="mb-2 text-sm font-semibold text-ink-soft">{day}</p>
            <div className="flex flex-col gap-2.5">
              {events.map((e) => {
                const c = getContact(e.contactId)!;
                const k = KIND[e.kind];
                return (
                  <Card key={e.id} className="flex flex-wrap items-center gap-4 p-4">
                    <div className="w-16 shrink-0 text-center">
                      <p className="text-sm font-bold">{e.time.split(" ")[0]}</p>
                      <p className="text-[11px] text-ink-soft">{e.time.split(" ")[1]}</p>
                    </div>
                    <div className="h-10 w-px bg-line" />
                    <Avatar name={c.name} size={40} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold">{e.title}</p>
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${k.cls}`}>{k.label}</span>
                      </div>
                      <p className="truncate text-xs text-ink-soft">{c.name} · {c.title} · {c.phone}</p>
                    </div>
                    {e.hasBrief && (
                      <span className="inline-flex items-center gap-1 rounded-lg bg-surface px-2.5 py-1 text-xs font-medium text-ink-soft">
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2}><path d="M9 5h6M7 3h10v18H7zM10 9h4M10 13h4" strokeLinecap="round" /></svg>
                        Brief ready
                      </span>
                    )}
                    <Link href={`/preview/contact/${c.id}`} className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium hover:bg-surface">Open</Link>
                  </Card>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
