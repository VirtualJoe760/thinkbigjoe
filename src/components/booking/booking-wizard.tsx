"use client";

import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { useEffect, useMemo, useRef, useState } from "react";

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const ADVANCE_DAYS = 30;

type Step = "intake" | "date" | "time" | "confirm" | "done";
type Slot = { start: string; end: string };

const INDUSTRY_OPTIONS = [
  ["financial-services", "Finance / insurance"],
  ["manufacturing", "Manufacturing / logistics"],
  ["ecommerce", "E-commerce / retail"],
  ["msps", "IT services / MSP"],
  ["law-firms", "Legal"],
  ["healthcare", "Healthcare"],
  ["real-estate", "Real estate"],
  ["other", "Other"],
] as const;

function dateKey(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function BookingWizard({
  industry,
  initialToken,
}: {
  /** Prefilled industry slug when embedded on an industry landing page. */
  industry?: string;
  /** Booking token from a prior intake (e.g. the homepage contact form). */
  initialToken?: string;
}) {
  const [step, setStep] = useState<Step>(initialToken ? "date" : "intake");
  const [token, setToken] = useState<string | null>(initialToken ?? null);

  // intake fields
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [industryValue, setIndustryValue] = useState(industry ?? "");
  const [teamSize, setTeamSize] = useState("");
  const [timeline, setTimeline] = useState("");
  const [problem, setProblem] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileInstance>(null);

  // booking state
  const [monthOffset, setMonthOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);

  const [busy, setBusy] = useState(false);
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
  const viewMonth = useMemo(
    () => new Date(today.getFullYear(), today.getMonth() + monthOffset, 1),
    [today, monthOffset],
  );
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

  // ── Slot fetch (token-gated) ────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedDate || !token) return;
    let cancelled = false;
    setSlotsLoading(true);
    setSlots([]);
    fetch(
      `/api/appointments/available-slots?date=${selectedDate}&token=${encodeURIComponent(token)}`,
    )
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
  }, [selectedDate, token]);

  // ── Intake submit ───────────────────────────────────────────────────────────
  async function submitIntake(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          phone,
          company,
          role,
          industry: industryValue,
          teamSize,
          timeline,
          problem,
          captchaToken,
          sourcePath:
            typeof window !== "undefined" ? window.location.pathname : "",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not submit — please try again.");
        turnstileRef.current?.reset();
        setCaptchaToken(null);
        return;
      }
      setToken(data.bookingToken);
      setStep("date");
    } catch {
      setError("Something went wrong. Please try again.");
      turnstileRef.current?.reset();
      setCaptchaToken(null);
    } finally {
      setBusy(false);
    }
  }

  // ── Book ────────────────────────────────────────────────────────────────────
  async function confirmBooking() {
    if (!selectedSlot || !token) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/appointments/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startTime: selectedSlot.start,
          endTime: selectedSlot.end,
          bookingToken: token,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not book the appointment.");
        if (res.status === 409) {
          setStep("time");
          setSelectedSlot(null);
          if (selectedDate) {
            const d = selectedDate;
            setSelectedDate(null);
            setTimeout(() => setSelectedDate(d), 0);
          }
        }
        if (res.status === 403) setStep("intake");
        return;
      }
      setStep("done");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString([], {
      weekday: "long",
      month: "long",
      day: "numeric",
    });

  const inputCls =
    "w-full rounded-xl border border-line bg-background px-4 py-3 text-ink placeholder:text-ink-soft/50 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30";

  // ── Done ────────────────────────────────────────────────────────────────────
  if (step === "done" && selectedSlot) {
    return (
      <div className="mx-auto w-full max-w-md text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-brand-tint">
          <svg viewBox="0 0 24 24" className="h-8 w-8 text-brand" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <h2 className="mt-6 text-3xl font-extrabold tracking-tight">
          You&apos;re booked.
        </h2>
        <p className="mt-3 text-ink-soft">
          {fmtDate(selectedSlot.start)} · {fmtTime(selectedSlot.start)}–
          {fmtTime(selectedSlot.end)}
        </p>
        <p className="mt-4 text-sm leading-relaxed text-ink-soft">
          A calendar invite with a video call link is on its way to your
          inbox. Talk soon — come ready to think big.
        </p>
      </div>
    );
  }

  const steps: Array<[Step, string]> = [
    ["intake", "1 · About you"],
    ["date", "2 · Date"],
    ["time", "3 · Time"],
    ["confirm", "4 · Confirm"],
  ];

  return (
    <div className="w-full">
      {/* step indicator */}
      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold tracking-wide text-ink-soft uppercase">
        {steps.map(([s, label], i) => (
          <span key={s} className="flex items-center gap-2">
            {i > 0 && <span className="h-px w-4 bg-line sm:w-6" />}
            <span className={step === s ? "text-brand" : ""}>{label}</span>
          </span>
        ))}
      </div>

      <div className="mt-6 rounded-2xl border border-line bg-background p-6 md:p-8">
        {step === "intake" && (
          <form onSubmit={submitIntake} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">Name *</span>
                <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" autoComplete="name" required />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">Work email *</span>
                <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@company.com" autoComplete="email" required />
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">Company *</span>
                <input className={inputCls} value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Acme Inc." autoComplete="organization" required />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">Your role</span>
                <input className={inputCls} value={role} onChange={(e) => setRole(e.target.value)} placeholder="Owner / Ops lead / CTO" autoComplete="organization-title" />
              </label>
            </div>

            <div className={`grid gap-4 ${industry ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
              {!industry && (
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium">Industry</span>
                  <select className={inputCls} value={industryValue} onChange={(e) => setIndustryValue(e.target.value)}>
                    <option value="">Select…</option>
                    {INDUSTRY_OPTIONS.map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                </label>
              )}
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">Team size</span>
                <select className={inputCls} value={teamSize} onChange={(e) => setTeamSize(e.target.value)}>
                  <option value="">Select…</option>
                  <option value="1">Just me</option>
                  <option value="2-10">2–10</option>
                  <option value="11-50">11–50</option>
                  <option value="51-200">51–200</option>
                  <option value="200+">200+</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">Timeline</span>
                <select className={inputCls} value={timeline} onChange={(e) => setTimeline(e.target.value)}>
                  <option value="">Select…</option>
                  <option value="asap">ASAP</option>
                  <option value="quarter">This quarter</option>
                  <option value="year">This year</option>
                  <option value="exploring">Just exploring</option>
                </select>
              </label>
            </div>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">
                What do you want to automate or build? *
              </span>
              <textarea
                className={inputCls}
                value={problem}
                onChange={(e) => setProblem(e.target.value)}
                rows={3}
                placeholder="Where is your team losing the most time?"
                required
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Phone (optional)</span>
              <input className={inputCls} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 555-5555" autoComplete="tel" />
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
                busy ||
                !name.trim() ||
                !email.trim() ||
                !company.trim() ||
                !problem.trim() ||
                (needsCaptcha && !captchaToken)
              }
              className="w-full rounded-full bg-brand px-5 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
            >
              {busy ? "Submitting…" : "Continue to pick a time"}
            </button>
            <p className="text-center text-xs text-ink-soft">
              Strategy-call slots are limited and reserved for completed
              intakes.
            </p>
          </form>
        )}

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
                <div key={i} className="py-2">{d}</div>
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
              Call windows are weekdays 10am–5pm Pacific · times shown in your
              timezone ({visitorZone}).
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
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {slots.map((slot) => (
                  <button
                    key={slot.start}
                    type="button"
                    onClick={() => {
                      setSelectedSlot(slot);
                      setStep("confirm");
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

        {step === "confirm" && selectedSlot && (
          <div className="text-center">
            <h2 className="text-xl font-bold tracking-tight">
              Lock it in?
            </h2>
            <p className="mt-3 rounded-xl bg-brand-tint px-4 py-3 text-sm font-semibold text-brand">
              {fmtDate(selectedSlot.start)} · {fmtTime(selectedSlot.start)}–
              {fmtTime(selectedSlot.end)}
            </p>
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <button
                type="button"
                onClick={() => setStep("time")}
                className="rounded-full border border-line px-6 py-3 text-sm font-semibold transition-colors hover:bg-surface"
              >
                Pick a different time
              </button>
              <button
                type="button"
                onClick={confirmBooking}
                disabled={busy}
                className="rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
              >
                {busy ? "Booking…" : "Confirm booking"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
