import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { db, forgeSites } from "@/db";
import { auth } from "@/lib/auth";
import { ReceptionistForm, type ReceptionistConfig } from "./receptionist-form";

export const metadata: Metadata = { title: "Set up your AI receptionist" };

export default async function ReceptionistSetupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(`/login?redirect=/portal/receptionist/${id}`);

  const siteId = Number(id);
  const [site] = Number.isFinite(siteId)
    ? await db.select().from(forgeSites).where(eq(forgeSites.id, siteId)).limit(1)
    : [];
  if (!site || site.claimedByUserId !== session.user.id) redirect("/portal");

  const config = (site.receptionistConfig as ReceptionistConfig | null) || {};
  const status = site.receptionistStatus || "none";
  const hasVoicePlan =
    site.oneTimePaid === true && (site.plan === "voice" || site.plan === "complete");

  return (
    <div className="flex flex-1 flex-col">

      <main className="mx-auto w-full max-w-xl flex-1 px-6 py-12">
        <Link href="/portal" className="text-sm font-semibold text-brand hover:underline">← Back to portal</Link>
        <p className="mt-4 text-sm font-semibold uppercase tracking-wide text-brand">AI receptionist</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">Set up your receptionist</h1>
        <p className="mt-3 leading-relaxed text-ink-soft">
          Tell your AI receptionist about <span className="font-semibold text-ink">{site.businessName}</span> so
          it can answer your phone, help callers, and book jobs 24/7. You can update this any time — our team
          activates the changes.
        </p>

        {!hasVoicePlan && (
          <div className="mt-6 rounded-xl border border-brand/40 bg-brand-tint p-4">
            <p className="text-sm font-semibold text-brand">🎙️ The receptionist comes with Website + Voice</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-soft">
              Fill this in now to get a head start — we&apos;ll save it as a draft. To switch your AI receptionist
              on, add the <span className="font-semibold text-ink">Website + Voice</span> (or Complete) plan from
              your portal, then re-save here and we&apos;ll provision it.
            </p>
            <Link
              href="/portal"
              className="mt-3 inline-flex items-center justify-center rounded-full bg-brand px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand-dark"
            >
              Choose a plan →
            </Link>
          </div>
        )}

        <div className="mt-8">
          <ReceptionistForm
            siteId={site.id}
            businessName={site.businessName}
            config={config}
            status={status}
            hasVoicePlan={hasVoicePlan}
          />
        </div>
      </main>
    </div>
  );
}
