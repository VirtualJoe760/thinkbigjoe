import type { Metadata } from "next";
import { desc, isNotNull } from "drizzle-orm";

import { db, leads } from "@/db";
import { requireAdmin } from "@/lib/require-admin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Appointments",
  robots: { index: false, follow: false },
};

function fmt(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function AppointmentsPage() {
  await requireAdmin();

  const rows = await db
    .select()
    .from(leads)
    .where(isNotNull(leads.bookedSlot))
    .orderBy(desc(leads.bookedSlot))
    .limit(200);

  const now = Date.now();
  const upcoming = rows.filter((r) => r.bookedSlot && new Date(r.bookedSlot).getTime() >= now);
  const past = rows.filter((r) => !r.bookedSlot || new Date(r.bookedSlot).getTime() < now);

  const Card = ({ l }: { l: (typeof rows)[number] }) => (
    <div className="rounded-2xl border border-line bg-background p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{l.name}</span>
        <span className="text-sm font-semibold text-brand">{fmt(l.bookedSlot)} PT</span>
      </div>
      <p className="mt-1 text-sm text-ink-soft">
        <a href={`mailto:${l.email}`} className="hover:text-ink">{l.email}</a>
        {l.company ? ` · ${l.company}` : ""}
        {l.phone ? ` · ${l.phone}` : ""}
      </p>
      {l.problem && (
        <p className="mt-2 rounded-xl bg-surface px-4 py-3 text-sm leading-relaxed">{l.problem}</p>
      )}
    </div>
  );

  return (
    <div className="px-6 py-8">
      <div className="mx-auto w-full max-w-4xl">
        <h1 className="text-2xl font-extrabold tracking-tight">Appointments</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Booked strategy calls. Invites with a Meet link go out via Google Calendar.
        </p>

        {rows.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-line bg-background p-10 text-center text-ink-soft">
            No booked calls yet. They appear here when someone completes the intake and books.
          </div>
        ) : (
          <div className="mt-6 space-y-6">
            {upcoming.length > 0 && (
              <div>
                <h2 className="mb-2 text-sm font-bold tracking-wide text-ink-soft uppercase">
                  Upcoming ({upcoming.length})
                </h2>
                <div className="space-y-3">
                  {upcoming.map((l) => <Card key={l.id} l={l} />)}
                </div>
              </div>
            )}
            {past.length > 0 && (
              <div>
                <h2 className="mb-2 text-sm font-bold tracking-wide text-ink-soft uppercase">
                  Past ({past.length})
                </h2>
                <div className="space-y-3 opacity-70">
                  {past.map((l) => <Card key={l.id} l={l} />)}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
