import { AGENTS } from "../_lib/data";
import { Card, PageHeader } from "../_components/ui";

const STATUS: Record<string, string> = {
  running: "bg-emerald-50 text-emerald-600",
  paused: "bg-amber-50 text-amber-600",
  off: "bg-surface text-ink-soft",
};

export default function Agents() {
  return (
    <>
      <PageHeader
        title="Agents"
        subtitle="Your workforce. Each agent runs on its own autonomy dial and daily caps."
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-background p-4">
        <div>
          <p className="text-sm font-semibold">Canary mode · Insurance · 20 contacts</p>
          <p className="text-xs text-ink-soft">Autonomous agents run inside hard caps. Pricing and flagged edge-cases always escalate to you.</p>
        </div>
        <button className="inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-100">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 2v10M6 6a8 8 0 1012 0" strokeLinecap="round" /></svg>
          Kill switch
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {AGENTS.map((a) => (
          <Card key={a.id} className="flex flex-col gap-3">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-semibold">{a.name}</h2>
                <p className="text-xs text-ink-soft">{a.role}</p>
              </div>
              <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold capitalize ${STATUS[a.status]}`}>{a.status}</span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-surface px-3 py-2">
                <p className="text-ink-soft">Today</p>
                <p className="mt-0.5 font-medium">{a.today}</p>
              </div>
              <div className="rounded-lg bg-surface px-3 py-2">
                <p className="text-ink-soft">Cohort</p>
                <p className="mt-0.5 font-medium">{a.cohort}</p>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-line pt-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-ink-soft">Autonomy</span>
                <span className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-xs font-medium capitalize">
                  {a.autonomy}
                  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2}><path d="M6 9l6 6 6-6" /></svg>
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-ink-soft">
                <span>last run {a.lastRun}</span>
                <span className={`relative inline-block h-4 w-7 rounded-full ${a.status === "off" ? "bg-line" : "bg-emerald-500"}`}>
                  <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white ${a.status === "off" ? "left-0.5" : "right-0.5"}`} />
                </span>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
