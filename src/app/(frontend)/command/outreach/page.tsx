import type { Metadata } from "next";

import { requireAdmin } from "@/lib/require-admin";
import { getOutreachQueue } from "@/lib/forge-outreach";
import { OutreachCard } from "./outreach-card";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Outreach review",
  robots: { index: false, follow: false },
};

export default async function OutreachPage() {
  await requireAdmin();
  const queue = await getOutreachQueue();

  const queued = queue.filter((q) => q.status === "queued");
  const sent = queue.filter((q) => q.status === "sent");
  const needsEmail = queue.filter((q) => q.status === "needs-email");
  const skipped = queue.filter((q) => q.status === "skipped");

  return (
    <div className="px-6 py-8">
      <div className="mx-auto w-full max-w-3xl">
        <h1 className="text-2xl font-extrabold tracking-tight">Outreach review</h1>
        <p className="mt-1 text-sm text-ink-soft">
          The owner-outreach for your built, approved sites. Read each message, open the site, and skip any you
          don&apos;t want. What&apos;s queued <span className="font-semibold text-ink">sends automatically at 10:00 AM</span>.
          Nothing sends before then — and you can pause everything from the Showroom dial in Prospecting.
        </p>

        <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold">
          <span className="rounded-full bg-blue-100 px-3 py-1 text-blue-700">{queued.length} queued for 10am</span>
          {sent.length > 0 && <span className="rounded-full bg-green-100 px-3 py-1 text-green-700">{sent.length} sent</span>}
          {needsEmail.length > 0 && <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-700">{needsEmail.length} need an email</span>}
          {skipped.length > 0 && <span className="rounded-full bg-line px-3 py-1 text-ink-soft">{skipped.length} skipped</span>}
        </div>

        {queue.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-line bg-background p-8 text-center text-ink-soft">
            No approved sites yet — approve built sites in Prospecting and they line up here for outreach.
          </div>
        ) : (
          <div className="mt-6 flex flex-col gap-3">
            {[...queued, ...needsEmail, ...skipped, ...sent].map((item) => (
              <OutreachCard key={item.id} item={item} />
            ))}
          </div>
        )}

        {needsEmail.length > 0 && (
          <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            {needsEmail.map((q) => q.businessName).join(" and ")} {needsEmail.length === 1 ? "has" : "have"} no email yet —
            the contact-enrichment run will try to find one; they join the send once they have an address.
          </p>
        )}
      </div>
    </div>
  );
}
