"use client";

import { useState } from "react";

import { ShowroomPanel, type ShowroomStats } from "./showroom-panel";
import { LeadEnginePanel, type LeadEngineStats } from "./lead-engine-panel";

const fmt = (n: number) => n.toLocaleString("en-US");

/**
 * Consolidated, collapsible container for the two prospecting engines (Showroom +
 * Lead). Collapsed by default with a one-line summary of both, so the queue below is
 * front-and-center; expand to see the full dials + controls.
 */
export function EnginesPanel({ showroom, lead }: { showroom: ShowroomStats | null; lead: LeadEngineStats | null }) {
  const [open, setOpen] = useState(false);
  if (!showroom && !lead) return null;

  const running = (showroom && (showroom.outreachEnabled || showroom.previewEnabled)) || (lead && lead.enabled);

  return (
    <section className="rounded-2xl border border-line bg-background">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold tracking-tight">Engines</h2>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${running ? "bg-green-100 text-green-700" : "bg-line text-ink-soft"}`}>
              {running ? "Running" : "Paused"}
            </span>
          </div>
          <p className="mt-1 truncate text-xs text-ink-soft">
            {lead && `Leads ${fmt(lead.leadsThisMonth)}/${fmt(lead.monthlyLeadGoal)} this mo · $${lead.spendUsd.toFixed(2)}/$${fmt(lead.monthlyBudgetUsd)}`}
            {lead && showroom && " · "}
            {showroom && `Showroom ${fmt(showroom.sent)} sent → ${fmt(showroom.paid)} paid`}
          </p>
        </div>
        <svg
          className={`h-5 w-5 shrink-0 text-ink-soft transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="space-y-5 border-t border-line px-5 py-5">
          {showroom && <ShowroomPanel stats={showroom} bare />}
          {showroom && lead && <div className="border-t border-line" />}
          {lead && <LeadEnginePanel stats={lead} bare />}
        </div>
      )}
    </section>
  );
}
