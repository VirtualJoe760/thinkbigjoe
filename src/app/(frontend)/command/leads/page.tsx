import type { Metadata } from "next";
import { desc } from "drizzle-orm";

import { db, leads } from "@/db";
import { requireAdmin } from "@/lib/require-admin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Leads",
  robots: { index: false, follow: false },
};

const SOURCE_LABEL: Record<string, string> = {
  "industry-page": "Industry page",
  "booking-page": "Booking page",
  "contact-form": "Contact form",
};

function statusPill(status: string) {
  const map: Record<string, string> = {
    new: "bg-brand-tint text-brand",
    booked: "bg-green-50 text-green-700",
    contacted: "bg-surface text-ink-soft",
    qualified: "bg-surface text-ink-soft",
    won: "bg-green-50 text-green-700",
    lost: "bg-surface text-red-600",
  };
  return map[status] || "bg-surface text-ink-soft";
}

export default async function LeadsPage() {
  await requireAdmin();

  const rows = await db.select().from(leads).orderBy(desc(leads.createdAt)).limit(200);

  return (
    <div className="px-6 py-8">
      <div className="mx-auto w-full max-w-4xl">
        <h1 className="text-2xl font-extrabold tracking-tight">Inbound leads</h1>
        <p className="mt-1 text-sm text-ink-soft">
          People who submitted the site forms (industry pages, booking intake, contact).
        </p>

        {rows.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-line bg-background p-10 text-center text-ink-soft">
            No inbound leads yet. They&apos;ll appear here as visitors submit the forms.
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            {rows.map((l) => (
              <div key={l.id} className="rounded-2xl border border-line bg-background p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{l.name}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusPill(String(l.status))}`}>
                    {l.status}
                  </span>
                  <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-ink-soft">
                    {SOURCE_LABEL[String(l.source)] || l.source}
                  </span>
                  {l.emailType === "business" && (
                    <span className="rounded-full bg-brand-tint px-2 py-0.5 text-xs font-medium text-brand">
                      business email
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-ink-soft">
                  <a href={`mailto:${l.email}`} className="hover:text-ink">{l.email}</a>
                  {l.company ? ` · ${l.company}` : ""}
                  {l.role ? ` · ${l.role}` : ""}
                  {l.phone ? ` · ${l.phone}` : ""}
                </p>
                {l.problem && (
                  <p className="mt-2 rounded-xl bg-surface px-4 py-3 text-sm leading-relaxed">
                    {l.problem}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
