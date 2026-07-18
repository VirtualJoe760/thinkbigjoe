"use client";

import { useState, useTransition } from "react";

import { Card } from "@/components/ui";

import { setDesignReportStatus } from "../actions";

export type DesignReport = {
  id: number;
  vertical: string;
  archetype: string | null;
  title: string;
  summary: string;
  findings: Record<string, unknown> | null;
  sources: { label?: string; url?: string }[] | null;
  languageId: string | null;
  status: string;
  createdAt: string | null;
};

const STATUS_STYLE: Record<string, string> = {
  proposed: "bg-amber-100 text-amber-800",
  verified: "bg-green-100 text-green-800",
  rejected: "bg-neutral-200 text-neutral-600",
};

function relTime(iso: string | null): string {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function hostOf(url?: string): string {
  if (!url) return "source";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function ReportCard({ report }: { report: DesignReport }) {
  const [status, setStatus] = useState(report.status);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  const act = (next: "verified" | "rejected") =>
    start(async () => {
      const res = await setDesignReportStatus(report.id, next);
      setNote(res.message);
      if (res.ok) setStatus(next);
    });

  const findings = report.findings ?? {};
  const findingKeys = Object.keys(findings);
  const sources = (report.sources ?? []).filter((s) => s && (s.url || s.label));

  return (
    <Card radius="xl" tone="surface" padding="sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand">{report.vertical}</span>
            {report.archetype && (
              <span className="rounded-full bg-ink/5 px-2 py-0.5 text-[11px] font-medium text-ink-soft">{report.archetype}</span>
            )}
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[status] ?? "bg-ink/5 text-ink-soft"}`}>
              {status}
            </span>
          </div>
          <h3 className="mt-1.5 text-sm font-bold tracking-tight text-ink">{report.title}</h3>
          <p className="mt-0.5 text-sm text-ink-soft">{report.summary}</p>
        </div>
        <span className="shrink-0 whitespace-nowrap text-[11px] text-ink-soft">{relTime(report.createdAt)}</span>
      </div>

      {/* Sources — the verification: real sites the agent studied */}
      {sources.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wide text-ink-soft">Studied:</span>
          {sources.map((s, i) => (
            <a
              key={i}
              href={s.url || "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border border-line bg-background px-2 py-0.5 text-[11px] font-medium text-brand hover:underline"
            >
              {s.label || hostOf(s.url)} ↗
            </a>
          ))}
        </div>
      )}

      {(findingKeys.length > 0 || report.languageId) && (
        <button
          onClick={() => setOpen((o) => !o)}
          className="mt-2.5 text-[11px] font-medium text-ink-soft hover:text-ink"
        >
          {open ? "− Hide details" : "+ Findings & design language"}
        </button>
      )}

      {open && (
        <div className="mt-2 space-y-1.5 rounded-lg bg-background/60 p-3">
          {report.languageId && (
            <p className="text-[12px] text-ink">
              <span className="font-semibold">Design language:</span>{" "}
              <code className="rounded bg-ink/5 px-1 py-0.5 text-[11px]">{report.languageId}</code>{" "}
              <span className="text-ink-soft">— build it from the Template designer above.</span>
            </p>
          )}
          {findingKeys.map((k) => (
            <p key={k} className="text-[12px] leading-snug text-ink-soft">
              <span className="font-semibold capitalize text-ink">{k.replace(/_/g, " ")}:</span>{" "}
              {typeof findings[k] === "string" ? (findings[k] as string) : JSON.stringify(findings[k])}
            </p>
          ))}
        </div>
      )}

      {/* Verify / reject — Joe's sign-off; steers the next research run */}
      <div className="mt-3 flex items-center gap-2">
        {status === "proposed" ? (
          <>
            <button
              onClick={() => act("verified")}
              disabled={pending}
              className="rounded-full bg-green-600 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-green-700 disabled:opacity-50"
            >
              {pending ? "…" : "✓ Verify"}
            </button>
            <button
              onClick={() => act("rejected")}
              disabled={pending}
              className="rounded-full border border-line px-3 py-1 text-xs font-semibold text-ink-soft transition-colors hover:bg-ink/5 disabled:opacity-50"
            >
              Reject
            </button>
          </>
        ) : (
          <button
            onClick={() => act(status === "verified" ? "rejected" : "verified")}
            disabled={pending}
            className="text-[11px] font-medium text-ink-soft hover:text-ink disabled:opacity-50"
          >
            {status === "verified" ? "Undo verify" : "Re-verify"}
          </button>
        )}
        {note && <span className="text-[11px] text-ink-soft">{note}</span>}
      </div>
    </Card>
  );
}

export function DesignReports({ reports }: { reports: DesignReport[] }) {
  if (reports.length === 0) {
    return (
      <p className="mt-2 text-sm text-ink-soft">
        No design research yet. The Brand Lead studies a vertical&apos;s best-in-class sites twice a day and files a
        report here — each one cites the sites it looked at, so you can verify the direction before it shapes a template.
      </p>
    );
  }
  return (
    <div className="mt-3 flex flex-col gap-3">
      {reports.map((r) => (
        <ReportCard key={r.id} report={r} />
      ))}
    </div>
  );
}
