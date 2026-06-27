import Link from "next/link";

const INFO: Record<string, { title: string; blurb: string; phase: string }> = {
  content: { title: "Content", blurb: "The Social agent's post queue — Instagram carousels and LinkedIn posts, drafted and scheduled.", phase: "Phase 3" },
  ads: { title: "Ads", blurb: "The Meta ads agent's retargeting audiences and spend, synced from consented contacts.", phase: "Phase 4" },
  activity: { title: "Activity", blurb: "Every agent action, audit-logged — verified vs. reported.", phase: "Phase 0" },
  settings: { title: "Settings", blurb: "Team, autonomy defaults, consent rules, and the global kill switch.", phase: "Phase 0" },
};

export default async function SectionStub({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const info = INFO[section] ?? { title: section, blurb: "Coming soon.", phase: "Later" };

  return (
    <div className="grid min-h-[420px] place-items-center">
      <div className="max-w-md text-center">
        <span className="mb-4 inline-block rounded-full bg-brand-tint px-3 py-1 text-xs font-semibold text-brand">{info.phase}</span>
        <h1 className="text-2xl font-bold tracking-tight">{info.title}</h1>
        <p className="mt-2 text-sm text-ink-soft">{info.blurb}</p>
        <Link href="/preview" className="mt-5 inline-block rounded-lg border border-line px-4 py-2 text-sm font-medium hover:bg-surface">← Back to overview</Link>
      </div>
    </div>
  );
}
