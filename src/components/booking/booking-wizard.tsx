"use client";

import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { useEffect, useMemo, useRef, useState } from "react";

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const ADVANCE_DAYS = 30;

type Step = "date" | "time" | "info" | "done";
type Slot = { start: string; end: string };

function dateKey(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function BookingWizard() {
  const [step, setStep] = useState<Step>("date");
  const [monthOffset, setMonthOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileInstance>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsCaptcha = Boolean(TURNSTILE_SITE_KEY);
  const visitorZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, " "),
    [],
  );

  // ── Calendar grid ───────────────────────────────────────────────────────────
  const today = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);
  const maxDate = useMemo(
    () => new Date(today.getTime() + ADVANCE_DAYS * 24 * 60 * 60 * 1000),
    [today],
  );

  const viewMonth = useMemo(() => {
    const d = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
    return d;
  }, [today, monthOffset]);

  const grid = useMemo(() => {
    const y = viewMonth.getFullYear();
    const m = viewMonth.getMonth();
    const firstWeekday = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const cells: Array<{ day: number; key: string; disabled: boolean } | null> = [];
    for (let i = 0; i < firstWeekday; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const cellDate = new Date(y, m, d);
      cells.push({
        day: d,
        key: dateKey(y, m, d),
        disabled: cellDate < today || cellDate > maxDate,
      });
    }
    return cells;
  }, [viewMonth, today, maxDate]);

  // ── Slot fetch ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedDate) return;
    let cancelled = false;
    setSlotsLoading(true);
    setSlots([]);
    fetch(`/api/appointments/available-slots?date=${selectedDate}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setSlots(Array.isArray(data.slots) ? data.slots : []);
      })
      .catch(() => {
        if (!cancelled) setSlots([]);
      })
      .finally(() => {
        if (!cancelled) setSlotsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDate]);

  // ── Submit ──────────────────────────────────────────────────────────────────
  async function book(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSlot) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/appointments/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          phone,
          message,
          startTime: selectedSlot.start,
          endTime: selectedSlot.end,
          captchaToken,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not book the appointment.");
        turnstileRef.current?.reset();
        setCaptchaToken(null);
        if (res.status === 409) {
          // Slot got taken — send them back to pick a new time.
          setStep("time");
          setSelectedSlot(null);
          setSlots([]);
          if (selectedDate) {
            const d = selectedDate;
            setSelectedDate(null);
            setTimeout(() => setSelectedDate(d), 0);
          }
        }
        return;
      }
      setStep("done");
    } catch {
      setError("Something went wrong. Please try again.");
      turnstileRef.current?.reset();
      setCaptchaToken(null);
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setStep("date");
    setSelectedDate(null);
    setSelectedSlot(null);
    setSlots([]);
    setName("");
    setEmail("");
    setPhone("");
    setMessage("");
    setCaptchaToken(null);
    setError(null);
  }

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString([], {
      weekday: "long",
      month: "long",
      day: "numeric",
    });

  // ── Confirmation ────────────────────────────────────────────────────────────
  if (step === "done" && selectedSlot) {
    return (
      <div className="mx-auto w-full max-w-md text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-brand-tint">
          <svg viewBox="0 0 24 24" className="h-8 w-8 text-brand" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <h1 className="mt-6 text-3xl font-extrabold tracking-tight">
          You&apos;re booked.
        </h1>
        <p className="mt-3 text-ink-soft">
          {fmtDate(selectedSlot.start)} · {fmtTime(selectedSlot.start)}–
          {fmtTime(selectedSlot.end)}
        </p>
        <p className="mt-4 text-sm leading-relaxed text-ink-soft">
          A calendar invite with a Google Meet link is on its way to{" "}
          <span className="font-semibold text-ink">{email}</span>. Talk soon —
          come ready to think big.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-8 rounded-full border border-line px-6 py-3 text-sm font-semibold transition-colors hover:bg-surface"
        >
          Book another time
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      <h1 className="text-3xl font-extrabold tracking-tight md:text-4xl">
        Book a strategy call
      </h1>
      <p className="mt-2 text-ink-soft">
        Free 30 minutes with Joe — we&apos;ll map where AI can actually move
        your business.
      </p>

      {/* step indicator */}
      <div className="mt-6 flex items-center gap-2 text-xs font-semibold tracking-wide text-ink-soft uppercase">
        <span className={step === "date" ? "text-brand" : ""}>1 · Date</span>
        <span className="h-px w-6 bg-line" />
        <span className={step === "time" ? "text-brand" : ""}>2 · Time</span>
        <span className="h-px w-6 bg-line" />
        <span className={step === "info" ? "text-brand" : ""}>3 · Details</span>
      </div>

      <div className="mt-6 rounded-2xl border border-line bg-background p-6 md:p-8">
        {step === "date" && (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">
                {viewMonth.toLocaleDateString([], { month: "long", year: "numeric" })}
              </h2>
              <div className="flex gap-1">
                <button
                  type="button"
                  aria-label="Previous month"
                  onClick={() => setMonthOffset((o) => Math.max(0, o - 1))}
                  disabled={monthOffset === 0}
                  className="grid h-9 w-9 place-items-center rounded-full border border-line transition-colors hover:bg-surface disabled:opacity-40"
                >
                  ‹
                </button>
                <button
                  type="button"
                  aria-label="Next month"
                  onClick={() => setMonthOffset((o) => Math.min(1, o + 1))}
                  disabled={monthOffset === 1}
                  className="grid h-9 w-9 place-items-center rounded-full border border-line transition-colors hover:bg-surface disabled:opacity-40"
                >
                  ›
                </button>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-ink-soft">
              {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                <div key={i} className="py-2">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {grid.map((cell, i) =>
                cell ? (
                  <button
                    key={cell.key}
                    type="button"
                    disabled={cell.disabled}
                    onClick={() => {
                      setSelectedDate(cell.key);
                      setSelectedSlot(null);
                      setStep("time");
                    }}
                    className={`aspect-square rounded-xl text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:text-ink-soft/30 ${
                      selectedDate === cell.key
                        ? "bg-brand text-white"
                        : "hover:bg-brand-tint"
                    }`}
                  >
                    {cell.day}
                  </button>
                ) : (
                  <div key={`pad-${i}`} />
                ),
              )}
            </div>
            <p className="mt-4 text-xs text-ink-soft">
              Times shown in your timezone ({visitorZone}).
            </p>
          </div>
        )}

        {step === "time" && selectedDate && (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">
                {new Date(selectedDate + "T12:00:00").toLocaleDateString([], {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </h2>
              <button
                type="button"
                onClick={() => setStep("date")}
                className="text-sm font-semibold text-brand hover:underline"
              >
                Change date
              </button>
            </div>

            {slotsLoading ? (
              <p className="py-8 text-center text-sm text-ink-soft">
                Checking availability…
              </p>
            ) : slots.length === 0 ? (
              <p className="py-8 text-center text-sm text-ink-soft">
                No available times on this day — try another date.
              </p>
            ) : (
              <div className="grid max-h-80 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
                {slots.map((slot) => (
                  <button
                    key={slot.start}
                    type="button"
                    onClick={() => {
                      setSelectedSlot(slot);
                      setStep("info");
                    }}
                    className="rounded-xl border border-line px-3 py-3 text-sm font-semibold transition-colors hover:border-brand hover:bg-brand-tint"
                  >
                    {fmtTime(slot.start)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {step === "info" && selectedSlot && (
          <form onSubmit={book} className="space-y-4">
            <div className="flex items-center justify-between rounded-xl bg-brand-tint px-4 py-3">
              <p className="text-sm font-semibold text-brand">
                {fmtDate(selectedSlot.start)} · {fmtTime(selectedSlot.start)}–
                {fmtTime(selectedSlot.end)}
              </p>
              <button
                type="button"
                onClick={() => setStep("time")}
                className="text-sm font-semibold text-brand hover:underline"
              >
                Change
              </button>
            </div>

            <Field label="Name" value={name} onChange={setName} placeholder="Jane Doe" autoComplete="name" required />
            <Field label="Email" type="email" value={email} onChange={setEmail} placeholder="jane@company.com" autoComplete="email" required />
            <Field label="Phone (optional)" type="tel" value={phone} onChange={setPhone} placeholder="(555) 555-5555" autoComplete="tel" />

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">
                What do you want to build? (optional)
              </span>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                placeholder="We want agents that handle inbound leads…"
                className="w-full rounded-xl border border-line bg-background px-4 py-3 text-ink placeholder:text-ink-soft/50 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
              />
            </label>

            {needsCaptcha && (
              <Turnstile
                ref={turnstileRef}
                siteKey={TURNSTILE_SITE_KEY as string}
                onSuccess={setCaptchaToken}
                onError={() => setCaptchaToken(null)}
                onExpire={() => setCaptchaToken(null)}
                options={{ theme: "light" }}
              />
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={
                submitting ||
                !name.trim() ||
                !email.trim() ||
                (needsCaptcha && !captchaToken)
              }
              className="w-full rounded-full bg-brand px-5 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
            >
              {submitting ? "Booking…" : "Confirm booking"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  autoComplete,
  required,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
        className="w-full rounded-xl border border-line bg-background px-4 py-3 text-ink placeholder:text-ink-soft/50 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
      />
    </label>
  );
}
