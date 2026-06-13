import type { Metadata } from "next";
import { headers as nextHeaders } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getPayload } from "payload";

import config from "@payload-config";
import { isAdminEmail } from "@/lib/admin";
import { Logo } from "@/components/logo";
import { StepCard, type Step } from "./step-card";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Prospect",
  robots: { index: false, follow: false },
};

const DIAGNOSTIC: Record<string, string> = {
  insurance:
    "Between application/quote intake, policy docs, and client retention follow-up — which eats the most of your team's day right now?",
  mortgage:
    "In your pipeline, where's the biggest time-sink: pulling loan docs and conditions, or keeping borrowers updated?",
  wealth:
    "Where does the most manual work pile up — client onboarding paperwork, reviews, or compliance comms?",
  law: "If one thing at your firm could draft or process itself — intake, first-draft docs, or case-file research — which would free up the most billable time?",
  msp: "Two things I help MSPs with — tier-1 ticket automation, and white-label AI you resell to clients. Which is more on your radar?",
  other:
    "What's the one workflow that, if it basically ran itself, would give your team the most time back?",
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
  const { id } = await params;
  const payload = await getPayload({ config });
  const { user } = await payload.auth({ headers: await nextHeaders() });
  if (!user || !isAdminEmail((user as { email?: string }).email)) {
    redirect("/admin/login");
  }

  let prospect;
  try {
    prospect = await payload.findByID({
      collection: "prospects",
      id,
      overrideAccess: true,
    });
  } catch {
    notFound();
  }
  if (!prospect) notFound();

  const p = prospect as unknown as {
    id: string;
    name?: string;
    title?: string;
    company?: string;
    vertical?: string;
    location?: string;
    degree?: string;
    hook?: string;
    fitScore?: number;
    fitReason?: string;
    profileUrl?: string;
  };
  const vertical = p.vertical || "other";
  const company = p.company || "";

  // ensure the full sequence exists (idempotent): diagnostic + invite drafts
  const pid = Number(id);
  const existing = await payload.find({
    collection: "outreach",
    where: { prospect: { equals: pid } },
    limit: 50,
    overrideAccess: true,
  });
  const haveSteps = new Set(existing.docs.map((d) => String(d.step)));
  const creates: Promise<unknown>[] = [];
  if (!haveSteps.has("diagnostic")) {
    creates.push(
      payload.create({
        collection: "outreach",
        overrideAccess: true,
        data: {
          prospect: pid,
          step: "diagnostic" as never,
          body: DIAGNOSTIC[vertical] || DIAGNOSTIC.other,
          status: "draft" as never,
        },
      }),
    );
  }
  if (!haveSteps.has("invite")) {
    creates.push(
      payload.create({
        collection: "outreach",
        overrideAccess: true,
        data: {
          prospect: pid,
          step: "invite" as never,
          body: inviteBody(company, vertical),
          status: "draft" as never,
        },
      }),
    );
  }
  if (creates.length) await Promise.all(creates);

  const refreshed = creates.length
    ? await payload.find({
        collection: "outreach",
        where: { prospect: { equals: pid } },
        limit: 50,
        overrideAccess: true,
      })
    : existing;

  const order: Record<string, number> = { connection: 0, diagnostic: 1, invite: 2, followup: 3 };
  const steps: Step[] = refreshed.docs
    .filter((d) => String(d.step) !== "reflect")
    .map((d) => ({ id: String(d.id), step: String(d.step), body: String(d.body || ""), status: String(d.status) }))
    .sort((a, b) => (order[a.step] ?? 9) - (order[b.step] ?? 9));

  const initials = (p.name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto w-full max-w-3xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <Logo />
          <a href="/command" className="text-sm font-medium text-ink-soft hover:text-ink">
            ‹ Back to queue
          </a>
        </div>

        {/* prospect header */}
        <div className="rounded-2xl border border-line bg-background p-6">
          <div className="flex items-start gap-4">
            <div className="grid h-12 w-12 flex-shrink-0 place-items-center rounded-full bg-brand-tint text-base font-semibold text-brand">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight">{p.name}</h1>
                <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">
                  fit {p.fitScore ?? 0}/6
                </span>
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
            {p.profileUrl && (
              <a
                href={p.profileUrl}
                target="_blank"
                rel="noreferrer"
                className="flex-shrink-0 rounded-full border border-line px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-surface"
              >
                Open profile ↗
              </a>
            )}
          </div>
        </div>

        {/* sequence */}
        <h2 className="mt-8 mb-3 text-lg font-bold tracking-tight">Outreach sequence</h2>
        <div className="space-y-3">
          {steps.map((s) => (
            <StepCard key={s.id} step={s} prospectId={id} canApprove={s.step === "connection"} />
          ))}

          {/* reflect — reply-dependent guidance */}
          <div className="rounded-2xl border border-line bg-surface p-5">
            <span className="text-sm font-bold tracking-tight">3 · Reflect (after they reply)</span>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">{REFLECT_GUIDANCE}</p>
          </div>
        </div>

        {/* solution sketch scaffold */}
        <h2 className="mt-8 mb-3 text-lg font-bold tracking-tight">Pre-call solution sketch</h2>
        <div className="rounded-2xl border border-line bg-background p-6 text-sm leading-relaxed text-ink-soft">
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
