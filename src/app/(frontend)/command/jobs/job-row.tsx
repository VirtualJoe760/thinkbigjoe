"use client";

import { useTransition } from "react";

import { cancelJob, requeueJob } from "./actions";

type Job = {
  id: number;
  status: string;
  intent: string;
  rawCommand: string;
  resultSummary: string | null;
  createdAt: string;
  label: string;
};

function statusPill(status: string) {
  const map: Record<string, string> = {
    queued: "bg-brand-tint text-brand",
    running: "bg-amber-50 text-amber-700",
    done: "bg-green-50 text-green-700",
    cancelled: "bg-surface text-ink-soft",
    failed: "bg-surface text-red-600",
  };
  return map[status] || "bg-surface text-ink-soft";
}

function ago(iso: string) {
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function JobRow({ job }: { job: Job }) {
  const [pending, start] = useTransition();

  return (
    <div className="rounded-2xl border border-line bg-background p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-ink-soft">#{job.id}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusPill(job.status)}`}>
          {job.status}
        </span>
        <span className="font-medium">{job.label}</span>
        <span className="ml-auto text-xs text-ink-soft">{ago(job.createdAt)}</span>
      </div>
      <p className="mt-1 text-xs text-ink-soft">
        “{job.rawCommand}”
      </p>
      {job.resultSummary && (
        <p className="mt-2 rounded-xl bg-surface px-3 py-2 text-sm">{job.resultSummary}</p>
      )}
      <div className="mt-3 flex gap-2">
        {job.status === "queued" && (
          <button
            disabled={pending}
            onClick={() => start(() => cancelJob(job.id))}
            className="rounded-lg border border-line px-3 py-1 text-xs font-medium text-ink-soft hover:bg-surface disabled:opacity-50"
          >
            Cancel
          </button>
        )}
        {(job.status === "cancelled" || job.status === "failed" || job.status === "done") && (
          <button
            disabled={pending}
            onClick={() => start(() => requeueJob(job.id))}
            className="rounded-lg border border-line px-3 py-1 text-xs font-medium text-ink-soft hover:bg-surface disabled:opacity-50"
          >
            Re-queue
          </button>
        )}
      </div>
    </div>
  );
}
