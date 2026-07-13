"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

/** A unified calendar item — a booked call (from Google Calendar) or a scheduled call-back. */
export type CalEvent = {
  id: string;
  kind: "appt" | "callback";
  title: string;
  start: string; // ISO
  end: string; // ISO
  allDay: boolean;
  meetLink?: string | null;
  htmlLink?: string | null;
  note?: string;
  sub?: string; // attendee / company / phone
  href?: string; // internal link (e.g. the lead)
};

type Parsed = CalEvent & { s: Date; e: Date };

const VIEWS = ["month", "week", "day"] as const;
type View = (typeof VIEWS)[number];

const HOUR_START = 7; // grid runs 7am–8pm; events outside clamp in
const HOUR_END = 20;
const HOUR_PX = 44;
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfWeek = (d: Date) => addDays(startOfDay(d), -startOfDay(d).getDay());
const fmtTime = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(":00", "");
const minsFromMidnight = (d: Date) => d.getHours() * 60 + d.getMinutes();

const KIND_STYLE: Record<CalEvent["kind"], { chip: string; block: string; dot: string; label: string }> = {
  appt: { chip: "bg-brand-tint text-brand", block: "bg-brand text-white border-brand-dark", dot: "bg-brand", label: "Booked call" },
  callback: { chip: "bg-amber-100 text-amber-800", block: "bg-amber-500 text-white border-amber-600", dot: "bg-amber-500", label: "Call-back" },
};

export function AppointmentCalendar({ events }: { events: CalEvent[] }) {
  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState<Date>(() => new Date());
  const [selected, setSelected] = useState<Parsed | null>(null);

  const parsed = useMemo<Parsed[]>(
    () => events.map((ev) => ({ ...ev, s: new Date(ev.start), e: new Date(ev.end) })).sort((a, b) => a.s.getTime() - b.s.getTime()),
    [events],
  );
  const eventsOn = (day: Date) => parsed.filter((ev) => sameDay(ev.s, day));

  const today = new Date();
  const step = (dir: number) => {
    if (view === "month") setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + dir, 1));
    else if (view === "week") setCursor(addDays(cursor, dir * 7));
    else setCursor(addDays(cursor, dir));
  };

  const title =
    view === "month"
      ? `${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`
      : view === "week"
        ? (() => {
            const s = startOfWeek(cursor);
            const e = addDays(s, 6);
            const sameMonth = s.getMonth() === e.getMonth();
            return `${MONTHS[s.getMonth()].slice(0, 3)} ${s.getDate()} – ${sameMonth ? "" : MONTHS[e.getMonth()].slice(0, 3) + " "}${e.getDate()}, ${e.getFullYear()}`;
          })()
        : cursor.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  return (
    <div>
      {/* toolbar */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setCursor(new Date())} className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-ink transition-colors hover:bg-surface">
            Today
          </button>
          <div className="flex items-center">
            <button onClick={() => step(-1)} aria-label="Previous" className="rounded-l-lg border border-line px-2.5 py-1.5 text-ink transition-colors hover:bg-surface">‹</button>
            <button onClick={() => step(1)} aria-label="Next" className="-ml-px rounded-r-lg border border-line px-2.5 py-1.5 text-ink transition-colors hover:bg-surface">›</button>
          </div>
          <h2 className="ml-1 text-lg font-bold tracking-tight">{title}</h2>
        </div>
        <div className="inline-flex overflow-hidden rounded-lg border border-line">
          {VIEWS.map((v, i) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3.5 py-1.5 text-sm font-semibold capitalize transition-colors ${i > 0 ? "border-l border-line" : ""} ${view === v ? "bg-brand text-white" : "bg-background text-ink-soft hover:bg-surface"}`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* legend */}
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-ink-soft">
        {(["appt", "callback"] as const).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${KIND_STYLE[k].dot}`} />
            {KIND_STYLE[k].label}
          </span>
        ))}
      </div>

      {view === "month" && <MonthView cursor={cursor} today={today} eventsOn={eventsOn} onPick={setSelected} onDay={(d) => { setCursor(d); setView("day"); }} />}
      {view === "week" && <TimeGrid days={Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(cursor), i))} today={today} parsed={parsed} onPick={setSelected} />}
      {view === "day" && <TimeGrid days={[startOfDay(cursor)]} today={today} parsed={parsed} onPick={setSelected} />}

      {selected && <EventModal ev={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function MonthView({
  cursor, today, eventsOn, onPick, onDay,
}: {
  cursor: Date; today: Date;
  eventsOn: (d: Date) => Parsed[];
  onPick: (e: Parsed) => void;
  onDay: (d: Date) => void;
}) {
  const gridStart = startOfWeek(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const inMonth = (d: Date) => d.getMonth() === cursor.getMonth();

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-background">
      <div className="grid grid-cols-7 border-b border-line bg-surface text-center text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
        {DOW.map((d) => <div key={d} className="py-2">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day, i) => {
          const evs = eventsOn(day);
          const isToday = sameDay(day, today);
          return (
            <div key={i} className={`min-h-[92px] border-b border-r border-line p-1.5 ${i % 7 === 6 ? "border-r-0" : ""} ${inMonth(day) ? "" : "bg-surface/40"}`}>
              <button
                onClick={() => onDay(day)}
                className={`mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold transition-colors hover:bg-surface ${isToday ? "bg-brand text-white hover:bg-brand" : inMonth(day) ? "text-ink" : "text-ink-soft"}`}
              >
                {day.getDate()}
              </button>
              <div className="space-y-1">
                {evs.slice(0, 3).map((ev) => (
                  <button
                    key={ev.id}
                    onClick={() => onPick(ev)}
                    title={ev.title}
                    className={`block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium ${KIND_STYLE[ev.kind].chip}`}
                  >
                    {!ev.allDay && <span className="tabular-nums opacity-80">{fmtTime(ev.s)} </span>}
                    {ev.title}
                  </button>
                ))}
                {evs.length > 3 && (
                  <button onClick={() => onDay(day)} className="px-1.5 text-[11px] font-semibold text-ink-soft hover:text-brand">
                    +{evs.length - 3} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TimeGrid({
  days, today, parsed, onPick,
}: {
  days: Date[]; today: Date; parsed: Parsed[]; onPick: (e: Parsed) => void;
}) {
  const hours = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i);
  const gridHeight = (HOUR_END - HOUR_START) * HOUR_PX;

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-background">
      {/* day headers */}
      <div className="flex border-b border-line bg-surface">
        <div className="w-14 shrink-0" />
        {days.map((d, i) => {
          const isToday = sameDay(d, today);
          return (
            <div key={i} className="flex-1 border-l border-line py-2 text-center">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{DOW[d.getDay()]}</div>
              <div className={`mx-auto mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold ${isToday ? "bg-brand text-white" : "text-ink"}`}>{d.getDate()}</div>
            </div>
          );
        })}
      </div>
      {/* all-day strip */}
      {days.some((d) => parsed.some((ev) => ev.allDay && sameDay(ev.s, d))) && (
        <div className="flex border-b border-line">
          <div className="flex w-14 shrink-0 items-center justify-end pr-2 text-[10px] uppercase text-ink-soft">all-day</div>
          {days.map((d, i) => (
            <div key={i} className="flex-1 space-y-1 border-l border-line p-1">
              {parsed.filter((ev) => ev.allDay && sameDay(ev.s, d)).map((ev) => (
                <button key={ev.id} onClick={() => onPick(ev)} className={`block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium ${KIND_STYLE[ev.kind].chip}`}>{ev.title}</button>
              ))}
            </div>
          ))}
        </div>
      )}
      {/* time grid */}
      <div className="flex overflow-x-auto">
        <div className="w-14 shrink-0">
          {hours.map((h) => (
            <div key={h} style={{ height: HOUR_PX }} className="relative">
              <span className="absolute -top-2 right-2 text-[10px] tabular-nums text-ink-soft">{h % 12 || 12}{h < 12 ? "a" : "p"}</span>
            </div>
          ))}
        </div>
        {days.map((day, di) => {
          const dayEvents = parsed.filter((ev) => !ev.allDay && sameDay(ev.s, day));
          return (
            <div key={di} className="relative min-w-[120px] flex-1 border-l border-line" style={{ height: gridHeight }}>
              {hours.slice(0, -1).map((h) => (
                <div key={h} style={{ top: (h - HOUR_START) * HOUR_PX, height: HOUR_PX }} className="absolute inset-x-0 border-b border-line/60" />
              ))}
              {sameDay(day, today) && <NowLine />}
              {dayEvents.map((ev) => {
                const startMin = Math.max(minsFromMidnight(ev.s), HOUR_START * 60);
                const endMin = Math.min(Math.max(minsFromMidnight(ev.e), startMin + 20), HOUR_END * 60);
                const top = ((startMin - HOUR_START * 60) / 60) * HOUR_PX;
                const height = Math.max(18, ((endMin - startMin) / 60) * HOUR_PX);
                return (
                  <button
                    key={ev.id}
                    onClick={() => onPick(ev)}
                    style={{ top, height }}
                    className={`absolute inset-x-1 overflow-hidden rounded-md border-l-4 px-1.5 py-0.5 text-left text-[11px] leading-tight shadow-sm ${KIND_STYLE[ev.kind].block}`}
                  >
                    <div className="font-semibold tabular-nums opacity-90">{fmtTime(ev.s)}</div>
                    <div className="truncate font-medium">{ev.title}</div>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NowLine() {
  const now = new Date();
  const min = minsFromMidnight(now);
  if (min < HOUR_START * 60 || min > HOUR_END * 60) return null;
  const top = ((min - HOUR_START * 60) / 60) * HOUR_PX;
  return (
    <div style={{ top }} className="absolute inset-x-0 z-10 flex items-center">
      <span className="-ml-1 h-2 w-2 rounded-full bg-red-500" />
      <span className="h-px flex-1 bg-red-500" />
    </div>
  );
}

function EventModal({ ev, onClose }: { ev: Parsed; onClose: () => void }) {
  const when = ev.allDay
    ? ev.s.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) + " · all day"
    : `${ev.s.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })} · ${fmtTime(ev.s)}–${fmtTime(ev.e)}`;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-2xl bg-background p-5 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className={`mb-1.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${KIND_STYLE[ev.kind].chip}`}>{KIND_STYLE[ev.kind].label}</span>
            <h3 className="text-base font-bold text-ink">{ev.title}</h3>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-full p-1 text-ink-soft hover:bg-surface" aria-label="Close">✕</button>
        </div>
        <p className="mt-2 text-sm font-semibold text-brand">{when} PT</p>
        {ev.sub && <p className="mt-1 text-sm text-ink-soft">{ev.sub}</p>}
        {ev.note && <p className="mt-3 whitespace-pre-wrap rounded-xl bg-surface px-3 py-2.5 text-sm leading-relaxed text-ink">{ev.note}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          {ev.meetLink && (
            <a href={ev.meetLink} target="_blank" rel="noreferrer" className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-dark">Join Meet</a>
          )}
          {ev.htmlLink && (
            <a href={ev.htmlLink} target="_blank" rel="noreferrer" className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-ink hover:bg-surface">Open in Google Calendar</a>
          )}
          {ev.href && (
            <Link href={ev.href} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-ink hover:bg-surface">View lead</Link>
          )}
        </div>
      </div>
    </div>
  );
}
