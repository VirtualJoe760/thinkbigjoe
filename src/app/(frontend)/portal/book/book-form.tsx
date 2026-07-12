"use client";

import { useEffect, useState, useTransition } from "react";
import { useActionState } from "react";

import { bookStrategyCall, getPortalSlots, requestCallOutsideWindow, type BookState, type PortalSlot } from "../actions";

const TZ = "America/Los_Angeles";
const initial: BookState = { ok: false, message: "" };

type DayOption = { date: string; weekday: string; label: string };

/** The next ~10 weekdays (Mon–Fri), as Pacific calendar dates. */
function upcomingWeekdays(count = 10): DayOption[] {
  const days: DayOption[] = [];
  const now = new Date();
  for (let i = 0; days.length < count && i < 30; i++) {
    const d = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
    const weekday = d.toLocaleDateString("en-US", { timeZone: TZ, weekday: "short" });
    if (weekday === "Sat" || weekday === "Sun") continue;
    // en-CA yields YYYY-MM-DD; force the Pacific calendar date so it matches the server.
    const date = d.toLocaleDateString("en-CA", { timeZone: TZ });
    const label = d.toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric" });
    days.push({ date, weekday, label });
  }
  return days;
}

function slotLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: TZ,
    hour: "numeric",
    minute: "2-digit",
  });
}

export function BookForm({ defaultName, email }: { defaultName?: string | null; email: string }) {
  const [days] = useState<DayOption[]>(() => upcomingWeekdays());
  const [selectedDate, setSelectedDate] = useState<string>(days[0]?.date ?? "");
  const [slots, setSlots] = useState<PortalSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<string>("");
  const [loadingSlots, startLoading] = useTransition();
  const [state, action, pending] = useActionState(bookStrategyCall, initial);

  useEffect(() => {
    if (!selectedDate) return;
    setSelectedSlot("");
    setSlots([]);
    startLoading(async () => {
      const res = await getPortalSlots(selectedDate);
      setSlots(res.slots);
    });
  }, [selectedDate]);

  if (state.ok) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
        <p className="text-lg font-bold text-emerald-900">You&apos;re booked 🎉</p>
        <p className="mt-2 text-sm leading-relaxed text-emerald-800">{state.message}</p>
      </div>
    );
  }

  return (
    <>
    <form action={action} className="space-y-6">
      <input type="hidden" name="startTime" value={selectedSlot} />

      <div>
        <p className="text-sm font-semibold text-ink">Pick a day</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {days.map((d) => {
            const active = d.date === selectedDate;
            return (
              <button
                key={d.date}
                type="button"
                onClick={() => setSelectedDate(d.date)}
                className={`rounded-xl border px-3 py-2 text-sm transition-colors ${
                  active
                    ? "border-brand bg-brand text-white"
                    : "border-line bg-background text-ink hover:border-brand"
                }`}
              >
                <span className="block text-xs font-semibold opacity-80">{d.weekday}</span>
                <span className="block font-semibold">{d.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="text-sm font-semibold text-ink">Pick a time <span className="font-normal text-ink-soft">(Pacific)</span></p>
        <div className="mt-2 min-h-[3rem]">
          {loadingSlots ? (
            <p className="text-sm text-ink-soft">Loading times…</p>
          ) : slots.length === 0 ? (
            <p className="text-sm text-ink-soft">No open times that day — try another.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {slots.map((s) => {
                const active = s.start === selectedSlot;
                return (
                  <button
                    key={s.start}
                    type="button"
                    onClick={() => setSelectedSlot(s.start)}
                    className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-colors ${
                      active
                        ? "border-brand bg-brand text-white"
                        : "border-line bg-background text-ink hover:border-brand"
                    }`}
                  >
                    {slotLabel(s.start)}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <label className="block">
        <span className="text-sm font-semibold text-ink">What do you want to talk about? <span className="font-normal text-ink-soft">(optional)</span></span>
        <textarea
          name="reason"
          rows={3}
          placeholder="e.g. I'd like to add the AI receptionist and connect my domain."
          className="mt-2 w-full rounded-xl border border-line bg-background px-3.5 py-2.5 text-sm leading-relaxed text-ink focus:border-brand focus:outline-none"
        />
      </label>

      <p className="text-xs text-ink-soft">
        Booking as <span className="font-semibold text-ink">{defaultName || email}</span> · {email}
      </p>

      {state.message && !state.ok && (
        <p className="text-sm font-medium text-red-600">{state.message}</p>
      )}

      <button
        type="submit"
        disabled={pending || !selectedSlot}
        className="inline-flex items-center justify-center rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-50"
      >
        {pending ? "Booking…" : selectedSlot ? `Book ${slotLabel(selectedSlot)}` : "Pick a time to book"}
      </button>
    </form>

    <div className="mt-6">
      <OutOfWindowRequest />
    </div>
    </>
  );
}

const owInitial: BookState = { ok: false, message: "" };

/** Ask for a time outside the 10–4 PT window — recorded as a request Joe confirms manually. */
function OutOfWindowRequest() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(requestCallOutsideWindow, owInitial);

  if (state.ok) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
        {state.message}
      </div>
    );
  }

  return (
    <div className="border-t border-line pt-4">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="text-sm font-semibold text-brand hover:underline">
          None of these times work? Request another →
        </button>
      ) : (
        <form action={action} className="space-y-3">
          <p className="text-sm text-ink-soft">
            Tell Joe when works and he&apos;ll confirm a time outside the usual 10am–4pm window and send you an invite.
          </p>
          <label className="block">
            <span className="text-sm font-semibold text-ink">When works for you?</span>
            <input
              name="preferred"
              placeholder="e.g. weekday mornings before 10, or Thursday afternoon"
              className="mt-2 w-full rounded-xl border border-line bg-background px-3.5 py-2.5 text-sm text-ink focus:border-brand focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-ink">Anything else? <span className="font-normal text-ink-soft">(optional)</span></span>
            <input
              name="reason"
              placeholder="What you'd like to talk about"
              className="mt-2 w-full rounded-xl border border-line bg-background px-3.5 py-2.5 text-sm text-ink focus:border-brand focus:outline-none"
            />
          </label>
          {state.message && !state.ok && <p className="text-sm font-medium text-red-600">{state.message}</p>}
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center justify-center rounded-full border border-line bg-background px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-50"
          >
            {pending ? "Sending…" : "Send request"}
          </button>
        </form>
      )}
    </div>
  );
}
