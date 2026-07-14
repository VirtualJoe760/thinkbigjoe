"use client";

import { useEffect, useMemo, useState } from "react";

type Slots = {
  ok: boolean;
  error?: string;
  businessName?: string;
  timezone?: string;
  slots?: string[];
};

/** Group ISO slots by their local day in the business's timezone. */
function byDay(slots: string[], tz: string) {
  const days = new Map<string, string[]>();
  for (const iso of slots) {
    const label = new Date(iso).toLocaleDateString("en-US", {
      timeZone: tz, weekday: "short", month: "short", day: "numeric",
    });
    days.set(label, [...(days.get(label) || []), iso]);
  }
  return [...days.entries()];
}

export function BookingForm({ slug, brand }: { slug: string; brand: string }) {
  const [data, setData] = useState<Slots | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", notes: "", company: "" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/site-booking?slug=${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ ok: false, error: "load" }));
  }, [slug]);

  const tz = data?.timezone || "America/New_York";
  const grouped = useMemo(() => byDay(data?.slots || [], tz), [data, tz]);

  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/site-booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, startISO: picked, ...form }),
      }).then((r) => r.json());
      if (res.ok) setDone(picked);
      else setError(res.message || "That didn't work — please try again.");
    } catch {
      setError("That didn't work — please try again.");
    }
    setBusy(false);
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center">
        <p className="text-2xl font-bold text-emerald-900">You&apos;re booked.</p>
        <p className="mt-2 text-emerald-800">
          {new Date(done).toLocaleString("en-US", {
            timeZone: tz, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit",
          })}
        </p>
        <p className="mt-3 text-sm text-emerald-800">
          We&apos;ve added it to our calendar{form.email ? ` and sent a confirmation to ${form.email}` : ""}. See you then.
        </p>
      </div>
    );
  }

  if (!data) return <p className="text-ink-soft">Loading available times…</p>;

  if (!data.ok) {
    // Be honest rather than showing slots that can't actually be booked.
    return (
      <div className="rounded-2xl border border-line bg-surface p-8 text-center">
        <p className="font-semibold text-ink">Online booking isn&apos;t switched on yet.</p>
        <p className="mt-2 text-ink-soft">Please give us a call and we&apos;ll get you scheduled.</p>
      </div>
    );
  }

  if (!grouped.length) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-8 text-center">
        <p className="font-semibold text-ink">No open times in the next two weeks.</p>
        <p className="mt-2 text-ink-soft">Please call us and we&apos;ll find a time.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-8">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">1. Pick a time</h2>
        <div className="mt-4 space-y-5">
          {grouped.map(([day, slots]) => (
            <div key={day}>
              <p className="text-sm font-semibold text-ink">{day}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {slots.map((iso) => (
                  <button
                    key={iso}
                    type="button"
                    onClick={() => setPicked(iso)}
                    className="rounded-full border px-4 py-2 text-sm font-semibold transition-colors"
                    style={
                      picked === iso
                        ? { background: brand, borderColor: brand, color: "#fff" }
                        : { borderColor: "var(--line)", color: "var(--ink)" }
                    }
                  >
                    {time(iso)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-ink-soft">Times shown in {tz.replace("_", " ")}.</p>
      </div>

      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">2. Your details</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <input
            required
            placeholder="Your name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="rounded-xl border border-line bg-surface px-4 py-3 text-base outline-none focus:border-brand"
          />
          <input
            type="tel"
            placeholder="Phone"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            className="rounded-xl border border-line bg-surface px-4 py-3 text-base outline-none focus:border-brand"
          />
          <input
            type="email"
            placeholder="Email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="rounded-xl border border-line bg-surface px-4 py-3 text-base outline-none focus:border-brand sm:col-span-2"
          />
          <textarea
            rows={3}
            placeholder="Anything we should know? (optional)"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            className="rounded-xl border border-line bg-surface px-4 py-3 text-base outline-none focus:border-brand sm:col-span-2"
          />
          {/* honeypot — hidden from humans */}
          <input
            tabIndex={-1}
            autoComplete="off"
            aria-hidden
            value={form.company}
            onChange={(e) => setForm({ ...form, company: e.target.value })}
            className="hidden"
          />
        </div>
        <p className="mt-2 text-xs text-ink-soft">Leave an email or a phone number so we can confirm.</p>
      </div>

      {error && <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p>}

      <button
        type="submit"
        disabled={!picked || busy || !form.name.trim() || (!form.email.trim() && !form.phone.trim())}
        className="w-full rounded-full px-6 py-4 text-base font-semibold text-white transition-opacity disabled:opacity-40"
        style={{ background: brand }}
      >
        {busy ? "Booking…" : picked ? `Book ${time(picked)}` : "Pick a time above"}
      </button>
    </form>
  );
}
