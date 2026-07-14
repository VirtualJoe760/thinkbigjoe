"use client";

import { useState } from "react";

import { AppointmentCalendar, type CalEvent } from "../../command/appointments/appointments-calendar";
import { setBookingLabel } from "./actions";

/**
 * Client-facing calendar: the customer chooses what to see. Website/AI bookings (kind "appt", stamped
 * by TBJ) are shown by default under a name they pick; their other personal Google events (kind
 * "other") are hidden by default and can be toggled on. They can rename the bookings category.
 */
export function ClientCalendar({ events, initialLabel }: { events: CalEvent[]; initialLabel: string }) {
  const [bookingLabel, setBookingLabelState] = useState(initialLabel);
  const [draft, setDraft] = useState(initialLabel);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [show, setShow] = useState({ appt: true, other: false });

  const bookingCount = events.filter((e) => e.kind === "appt").length;
  const otherCount = events.filter((e) => e.kind === "other").length;
  const shown = events.filter(
    (e) => (e.kind === "appt" && show.appt) || (e.kind === "other" && show.other) || e.kind === "callback",
  );

  const save = async () => {
    const name = draft.trim() || "Website & AI bookings";
    setSaving(true);
    try { await setBookingLabel(name); setBookingLabelState(name); setEditing(false); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Show</span>
        <FilterChip active={show.appt} dot="bg-brand" onClick={() => setShow((s) => ({ ...s, appt: !s.appt }))} label={`${bookingLabel} (${bookingCount})`} />
        <FilterChip active={show.other} dot="bg-slate-400" onClick={() => setShow((s) => ({ ...s, other: !s.other }))} label={`Other calendar events (${otherCount})`} />
        {editing ? (
          <span className="inline-flex items-center gap-1.5">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={60}
              autoFocus
              placeholder="Name your bookings"
              className="w-48 rounded-lg border border-line bg-background px-2.5 py-1.5 text-xs text-ink outline-none focus:border-brand"
            />
            <button onClick={save} disabled={saving} className="rounded-lg bg-brand px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
            <button onClick={() => { setEditing(false); setDraft(bookingLabel); }} className="text-xs text-ink-soft hover:text-ink">Cancel</button>
          </span>
        ) : (
          <button onClick={() => setEditing(true)} className="text-xs font-semibold text-brand hover:underline">✎ Rename bookings</button>
        )}
      </div>

      <AppointmentCalendar events={shown} hideLegend kindLabels={{ appt: bookingLabel, other: "Personal event" }} />
    </div>
  );
}

function FilterChip({ active, dot, onClick, label }: { active: boolean; dot: string; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${active ? "border-brand bg-brand-tint text-brand" : "border-line bg-background text-ink-soft hover:bg-surface"}`}
    >
      <span className={`h-2 w-2 rounded-full ${active ? dot : "bg-ink-soft/40"}`} />
      {label}
    </button>
  );
}
