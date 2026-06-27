import { AGENTS, CONTACTS, CLIENTS, ACTIVITY, STAGE_LABEL, type Stage } from "./_lib/data";
import { Card, OwnerTag, PageHeader } from "./_components/ui";

function Metric({ label, value, tone = "ink" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-background p-4">
      <p className="text-xs font-medium text-ink-soft">{label}</p>
      <p className={`mt-1 text-3xl font-bold ${tone === "brand" ? "text-brand" : ""}`}>{value}</p>
    </div>
  );
}

const FUNNEL: Stage[] = ["new", "connected", "in_conversation", "meeting", "won"];

export default function Overview() {
  const inConvo = CONTACTS.filter((c) => c.stage === "in_conversation").length;
  const booked = CONTACTS.filter((c) => c.stage === "meeting").length;
  const counts = FUNNEL.reduce((acc, s) => {
    acc[s] = CONTACTS.filter((c) => c.stage === s).length;
    return acc;
  }, {} as Record<Stage, number>);
  const max = Math.max(...Object.values(counts), 1);
  const running = AGENTS.filter((a) => a.status === "running").length;

  return (
    <>
      <PageHeader title="Overview" subtitle="The numbers — your pipeline is running autonomously on the insurance canary." />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Active contacts" value={String(CONTACTS.length)} tone="brand" />
        <Metric label="In conversation" value={String(inConvo)} />
        <Metric label="Booked this week" value={String(booked)} />
        <Metric label="Active clients" value={String(CLIENTS.length)} />
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Card>
            <h2 className="mb-4 font-semibold">Pipeline funnel</h2>
            <div className="flex flex-col gap-3">
              {FUNNEL.map((s) => (
                <div key={s} className="flex items-center gap-3">
                  <span className="w-32 shrink-0 text-sm text-ink-soft">{STAGE_LABEL[s]}</span>
                  <div className="h-7 flex-1 overflow-hidden rounded-md bg-surface">
                    <div className="flex h-full items-center rounded-md bg-brand px-2" style={{ width: `${Math.max((counts[s] / max) * 100, 8)}%` }}>
                      <span className="text-xs font-semibold text-white">{counts[s]}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5 flex items-center gap-2 border-t border-line pt-4 text-sm">
              <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              <span className="font-medium">{running} of {AGENTS.length} agents running</span>
              <span className="text-ink-soft">· Research, Communication, Meeting strategist</span>
            </div>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card>
            <h2 className="mb-3 font-semibold">Agent activity</h2>
            <div className="flex flex-col gap-3">
              {ACTIVITY.map((a, i) => (
                <div key={i} className="flex gap-2.5">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                  <div>
                    <p className="text-sm leading-snug">{a.text}</p>
                    <div className="mt-0.5 flex items-center gap-2">
                      <OwnerTag owner={a.agent} />
                      <span className="text-[11px] text-ink-soft/70">{a.when}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
