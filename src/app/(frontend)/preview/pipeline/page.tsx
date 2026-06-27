"use client";

import { useState } from "react";
import Link from "next/link";
import { BOARD_STAGES, CONTACTS, STAGE_LABEL, type Stage } from "../_lib/data";
import { Avatar, OwnerTag, PageHeader, TempPill } from "../_components/ui";

function Filter({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-lg border border-line bg-background px-3 py-1.5 text-xs font-medium text-ink-soft">
      {label}
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2}><path d="M6 9l6 6 6-6" /></svg>
    </span>
  );
}

function count(stage: Stage) {
  return CONTACTS.filter((c) => c.stage === stage).length;
}

export default function Pipeline() {
  const [sel, setSel] = useState<Stage>("in_conversation");
  const [open, setOpen] = useState(false);
  const selected = CONTACTS.filter((c) => c.stage === sel);

  return (
    <>
      <PageHeader
        title="Pipeline"
        subtitle="Track every deal by stage, temperature and owner."
        right={
          <div className="hidden flex-wrap gap-2 sm:flex">
            <Filter label="All verticals" />
            <Filter label="Any temperature" />
            <Filter label="Any owner" />
          </div>
        }
      />

      {/* Mobile: stage selector + focused list */}
      <div className="lg:hidden">
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-haspopup="listbox"
            aria-expanded={open}
            className="flex w-full items-center justify-between rounded-xl border border-line bg-background px-4 py-2.5 text-sm font-medium"
          >
            <span>{STAGE_LABEL[sel]} <span className="text-ink-soft">· {count(sel)}</span></span>
            <svg viewBox="0 0 24 24" className={`h-4 w-4 text-ink-soft transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
          </button>
          {open && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
              <div role="listbox" className="absolute left-0 right-0 z-20 mt-1.5 overflow-hidden rounded-xl border border-line bg-background shadow-lg">
                {BOARD_STAGES.map((s) => {
                  const active = s === sel;
                  return (
                    <button
                      key={s}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => { setSel(s); setOpen(false); }}
                      className={`flex w-full items-center justify-between px-4 py-2.5 text-sm ${active ? "bg-brand-tint font-medium text-brand" : "hover:bg-surface"}`}
                    >
                      <span>{STAGE_LABEL[s]}</span>
                      <span className={active ? "text-brand" : "text-ink-soft"}>{count(s)}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className="mt-4 flex flex-col gap-2.5">
          {selected.map((c) => (
            <Link key={c.id} href={`/preview/contact/${c.id}`} className="flex items-center gap-3 rounded-xl border border-line bg-background p-3.5 active:bg-surface">
              <Avatar name={c.name} size={42} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{c.name}</p>
                <p className="truncate text-xs text-ink-soft">{c.company} · {c.vertical}</p>
                <div className="mt-1.5"><OwnerTag owner={c.owner.split(" ")[0]} /></div>
              </div>
              <TempPill t={c.temperature} />
            </Link>
          ))}
          {!selected.length && <p className="py-6 text-center text-sm text-ink-soft">No contacts in this stage.</p>}
        </div>
      </div>

      {/* Desktop: kanban grid */}
      <div className="hidden gap-3 lg:grid lg:grid-cols-4">
        {BOARD_STAGES.map((stage) => {
          const cards = CONTACTS.filter((c) => c.stage === stage);
          return (
            <div key={stage} className="rounded-2xl bg-background/60 p-2.5">
              <div className="mb-2 flex items-center justify-between px-1.5">
                <span className="text-sm font-semibold">{STAGE_LABEL[stage]}</span>
                <span className="rounded-md bg-surface px-1.5 text-xs font-medium text-ink-soft">{cards.length}</span>
              </div>
              <div className="flex flex-col gap-2">
                {cards.map((c) => (
                  <Link key={c.id} href={`/preview/contact/${c.id}`} className="block rounded-xl border border-line bg-background p-3 transition-shadow hover:shadow-sm">
                    <p className="text-sm font-semibold leading-tight">{c.name}</p>
                    <p className="mb-2.5 truncate text-xs text-ink-soft">{c.company}</p>
                    <div className="flex items-center justify-between">
                      <TempPill t={c.temperature} />
                      <OwnerTag owner={c.owner.split(" ")[0]} />
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
