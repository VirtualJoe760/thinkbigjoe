import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";

import { db, outreach, prospects } from "@/db";
import { requireAdmin } from "@/lib/require-admin";
import { parseProspectRecon } from "@/lib/prospect-recon";
import { StepCard, type Step } from "./step-card";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Prospect",
  robots: { index: false, follow: false },
};

const DIAGNOSTIC: Record<string, string> = {
  insurance:
    "Thanks so much for connecting — no agenda here, just genuinely curious: what's the part of running the agency that eats more of your week than it probably should?",
  mortgage:
    "Thanks for connecting — genuinely curious, no pitch: in your pipeline, what quietly eats the most time — chasing docs and conditions, or keeping borrowers in the loop?",
  wealth:
    "Thanks for connecting — no agenda, just curious: where does the most manual or admin work tend to pile up for your team these days?",
  law: "Thanks for connecting — genuinely curious, and not selling anything: what's the work at the firm that eats the most time but doesn't really need a lawyer's brain to do?",
  msp: "Thanks for connecting — curious, no pitch: what's the most repetitive thing your team handles day to day that you kind of wish just took care of itself?",
  other:
    "Thanks for connecting — no agenda, just curious: what's the one task that eats more of your team's week than it probably should?",
};

const INDUSTRY_SLUG: Record<string, string> = {
  insurance: "financial-services",
  mortgage: "financial-services",
  wealth: "financial-services",
  law: "law-firms",
  msp: "msps",
};

const REFLECT_GUIDANCE =
  "When they answer, don't jump to a call. Restate their pain in your words → sketch how you'd build it in 1–2 sentences → drop one non-obvious insight → then offer the walkthrough. Keep the branch that matches what they actually said.";

function inviteBody(company: string, vertical: string) {
  const slug = INDUSTRY_SLUG[vertical];
  const url = slug
    ? `thinkbigjoe.com/for/${slug}`
    : "thinkbigjoe.com/book-appointment";
  return `Perfect. Grab a slot here — it asks a couple quick questions first so I can prep something specific to ${company || "your business"}: ${url}`;
}

export default async function ProspectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const pid = Number(id);
  if (!Number.isFinite(pid)) notFound();

  const found = await db
    .select()
    .from(prospects)
    .where(eq(prospects.id, pid))
    .limit(1);
  const p = found[0];
  if (!p) notFound();

  const vertical = p.vertical ? String(p.vertical) : "other";
  const company = p.company || "";
  const recon = parseProspectRecon(p.recon);

  // ensure the full sequence exists (idempotent): diagnostic + invite drafts
  const existing = await db
    .select({ step: outreach.step })
    .from(outreach)
    .where(eq(outreach.prospectId, pid));
  const haveSteps = new Set(existing.map((d) => String(d.step)));
  const toInsert: Array<{ prospectId: number; step: "diagnostic" | "invite"; body: string; status: "draft" }> = [];
  if (!haveSteps.has("diagnostic")) {
    toInsert.push({ prospectId: pid, step: "diagnostic", body: DIAGNOSTIC[vertical] || DIAGNOSTIC.other, status: "draft" });
  }
  if (!haveSteps.has("invite")) {
    toInsert.push({ prospectId: pid, step: "invite", body: inviteBody(company, vertical), status: "draft" });
  }
  if (toInsert.length) await db.insert(outreach).values(toInsert);

  const rows = await db
    .select({ id: outreach.id, step: outreach.step, body: outreach.body, status: outreach.status })
    .from(outreach)
    .where(eq(outreach.prospectId, pid));

  const order: Record<string, number> = { connection: 0, diagnostic: 1, invite: 2, followup: 3 };
  const steps: Step[] = rows
    .filter((d) => String(d.step) !== "reflect")
    .map((d) => ({ id: String(d.id), step: String(d.step), body: String(d.body || ""), status: String(d.status || "draft") }))
    .sort((a, b) => (order[a.step] ?? 9) - (order[b.step] ?? 9));

  const initials = (p.name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto w-full max-w-4xl">
        <div className="mb-6">
          <Link href="/command/prospects" className="text-sm font-medium text-ink-soft hover:text-ink">
            ‹ Back to queue
          </Link>
        </div>

        <div className="rounded-xl border border-line bg-background p-4 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div
              className="grid h-16 w-16 flex-shrink-0 place-items-center overflow-hidden rounded-full bg-brand-tint bg-cover bg-center text-base font-semibold text-brand"
              style={recon.photoUrl ? { backgroundImage: `url("${recon.photoUrl}")` } : undefined}
              aria-hidden="true"
            >
              {!recon.photoUrl && initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight">{p.name}</h1>
                <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">
                  fit {Number(p.fitScore || 0)}/6
                </span>
                {recon.websiteRating && (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                    site {recon.websiteRating}/10
                  </span>
                )}
                {p.degree && (
                  <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-ink-soft">
                    {p.degree}
                  </span>
                )}
              </div>
              <p className="mt-1 text-ink-soft">
                {[p.title, p.company].filter(Boolean).join(", ")}
                {p.location ? ` · ${p.location}` : ""}
              </p>
              {p.hook && <p className="mt-2 text-sm text-ink-soft">💡 {p.hook}</p>}
              {p.fitReason && (
                <p className="mt-1 text-sm text-ink-soft">
                  <span className="font-medium text-ink">Angle:</span> {p.fitReason}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2 sm:justify-end">
              {p.source && (
                <span
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                    p.source === "linkedin"
                      ? "bg-blue-50 text-blue-700"
                      : "bg-green-50 text-green-700"
                  }`}
                >
                  {p.source === "linkedin" ? "LinkedIn" : "Google"}
                </span>
              )}
              {p.profileUrl && (
                <a
                  href={p.profileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-surface"
                >
                  LinkedIn
                </a>
              )}
              {recon.googleMyBusinessUrl && (
                <a
                  href={recon.googleMyBusinessUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-surface"
                >
                  Google
                </a>
              )}
              {recon.websiteUrl && (
                <a
                  href={recon.websiteUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-surface"
                >
                  Website
                </a>
              )}
              {recon.email && (
                <a
                  href={`mailto:${recon.email}`}
                  className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-surface"
                >
                  {recon.email}
                </a>
              )}
              {recon.phone && (
                <a
                  href={`tel:${recon.phone}`}
                  className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-surface"
                >
                  {recon.phone}
                </a>
              )}
            </div>
          </div>
        </div>

        {(recon.websiteStatus || recon.websiteNotes || recon.salesOpportunities.length > 0) && (
          <div className="mt-4 grid gap-3 rounded-xl border border-line bg-background p-4 text-sm leading-relaxed md:grid-cols-[0.9fr_1.1fr]">
            <div>
              <h2 className="font-bold tracking-tight">Website research</h2>
              {recon.websiteStatus && <p className="mt-1 text-ink-soft">{recon.websiteStatus}</p>}
              {recon.websiteNotes && <p className="mt-2 text-ink-soft">{recon.websiteNotes}</p>}
            </div>
            {recon.salesOpportunities.length > 0 && (
              <div>
                <h2 className="font-bold tracking-tight">Sales opportunities</h2>
                <ul className="mt-2 space-y-1.5 text-ink-soft">
                  {recon.salesOpportunities.map((opportunity) => (
                    <li key={opportunity}>• {opportunity}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <h2 className="mt-8 mb-3 text-lg font-bold tracking-tight">Outreach sequence</h2>
        <div className="space-y-3">
          {steps.map((s) => (
            <StepCard key={s.id} step={s} prospectId={id} canApprove={s.step === "connection"} />
          ))}

          <div className="rounded-xl border border-line bg-surface p-5">
            <span className="text-sm font-bold tracking-tight">3 · Reflect (after they reply)</span>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">{REFLECT_GUIDANCE}</p>
          </div>
        </div>

        <h2 className="mt-8 mb-3 text-lg font-bold tracking-tight">Pre-call solution sketch</h2>
        <div className="rounded-xl border border-line bg-background p-5 text-sm leading-relaxed text-ink-soft sm:p-6">
          <p className="font-medium text-ink">Fill before the call:</p>
          <ul className="mt-2 space-y-1.5">
            <li>• Stated pain: ______________________</li>
            <li>• Workflow to automate first: ______________________</li>
            <li>• What the agent does: 1) ___ 2) ___ 3) ___</li>
            <li>• Human-in-the-loop at: ______________________</li>
            <li>• Plugs into (their system): ______________________</li>
            <li>• Rough before → after: ~__ hrs/wk → ~__ hrs/wk</li>
            <li>• First step to propose: build + monthly managed retainer</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
