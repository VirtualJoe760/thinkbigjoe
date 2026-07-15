import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { db, forgeSites } from "@/db";
import { auth } from "@/lib/auth";
import { ReceptionistForm, type ReceptionistConfig } from "./[id]/receptionist-form";

export const metadata: Metadata = { title: "Set up your AI receptionist" };

// Standalone entry point for the AI receptionist (linked from the portal's "Your
// AI" section). The receptionist config attaches to a claimed site, so this page
// resolves the user's site — one site renders inline, several offer a switcher
// (?site=), none prompts to get a site first. It reuses the same <ReceptionistForm>
// as /portal/receptionist/[id]. (Stripe gating for the voice add-on is deferred.)
export default async function ReceptionistPage({
  searchParams,
}: {
  searchParams: Promise<{ site?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login?redirect=/portal/receptionist");

  const { user } = session;
  const sites = await db
    .select()
    .from(forgeSites)
    .where(eq(forgeSites.claimedByUserId, user.id));

  const { site: siteParam } = await searchParams;
  const requested = sites.find((s) => String(s.id) === siteParam);
  const site = requested ?? sites[0];

  return (
    <div className="flex flex-1 flex-col">

      <main className="mx-auto w-full max-w-xl flex-1 px-6 py-12">
        <Link href="/portal" className="text-sm font-semibold text-brand hover:underline">
          ← Back to portal
        </Link>
        <p className="mt-4 text-sm font-semibold uppercase tracking-wide text-brand">AI receptionist</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">Set up your receptionist</h1>

        {!site ? (
          <>
            <p className="mt-3 leading-relaxed text-ink-soft">
              Your AI receptionist answers your phone, helps callers, and books jobs 24/7. It attaches to
              your website, so you&apos;ll set it up once you have a site.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Link
                href="/portal/build"
                className="inline-flex items-center justify-center rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-dark"
              >
                🛠️ Build a site
              </Link>
              <Link
                href="/portal/claim"
                className="inline-flex items-center justify-center rounded-full border border-line bg-background px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-surface"
              >
                I have a claim code
              </Link>
            </div>
          </>
        ) : (
          <>
            <p className="mt-3 leading-relaxed text-ink-soft">
              Tell your AI receptionist about{" "}
              <span className="font-semibold text-ink">{site.businessName}</span> so it can answer your
              phone, help callers, and book jobs 24/7. You can update this any time — our team activates
              the changes.
            </p>

            {sites.length > 1 && (
              <div className="mt-6">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                  Which business?
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {sites.map((s) => {
                    const active = s.id === site.id;
                    return (
                      <Link
                        key={s.id}
                        href={`/portal/receptionist?site=${s.id}`}
                        className={`inline-flex items-center rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
                          active
                            ? "border-brand bg-brand-tint text-brand"
                            : "border-line bg-background text-ink-soft hover:bg-surface hover:text-ink"
                        }`}
                      >
                        {s.businessName}
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}

            {(() => {
              const hasVoicePlan =
                site.oneTimePaid === true && (site.plan === "voice" || site.plan === "complete");
              return (
                <>
                  {!hasVoicePlan && (
                    <div className="mt-6 rounded-xl border border-brand/40 bg-brand-tint p-4">
                      <p className="text-sm font-semibold text-brand">
                        🎙️ The receptionist comes with Website + Voice
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-ink-soft">
                        Fill this in now to get a head start — we&apos;ll save it as a draft. To switch your
                        AI receptionist on, add the{" "}
                        <span className="font-semibold text-ink">Website + Voice</span> (or Complete) plan
                        from your portal, then re-save here and we&apos;ll provision it.
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
                      config={(site.receptionistConfig as ReceptionistConfig | null) || {}}
                      status={site.receptionistStatus || "none"}
                      hasVoicePlan={hasVoicePlan}
                    />
                  </div>
                </>
              );
            })()}
          </>
        )}
      </main>
    </div>
  );
}
