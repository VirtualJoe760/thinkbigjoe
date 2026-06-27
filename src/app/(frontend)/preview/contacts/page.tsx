import Link from "next/link";
import { CONTACTS, LIFECYCLE_TABS, type Lifecycle } from "../_lib/data";
import { Avatar, PageHeader, TempPill } from "../_components/ui";

const LIFE: Record<string, string> = {
  prospect: "bg-surface text-ink-soft",
  lead: "bg-brand-tint text-brand",
  client: "bg-emerald-50 text-emerald-600",
  past_client: "bg-surface text-ink-soft",
};

export default async function Contacts({ searchParams }: { searchParams: Promise<{ life?: string }> }) {
  const { life = "all" } = await searchParams;
  const rows = CONTACTS.filter((c) => life === "all" || c.lifecycle === (life as Lifecycle));

  return (
    <>
      <PageHeader title="Contacts" subtitle="One record per person — cycle from prospect to lead to client." />

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {LIFECYCLE_TABS.map((t) => {
          const active = t.key === life;
          const count = t.key === "all" ? CONTACTS.length : CONTACTS.filter((c) => c.lifecycle === t.key).length;
          return (
            <Link
              key={t.key}
              href={t.key === "all" ? "/preview/contacts" : `/preview/contacts?life=${t.key}`}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                active ? "bg-ink text-white" : "border border-line bg-background text-ink-soft hover:bg-surface"
              }`}
            >
              {t.label} <span className={active ? "text-white/70" : "text-ink-soft/60"}>{count}</span>
            </Link>
          );
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((c) => (
          <Link
            key={c.id}
            href={`/preview/contact/${c.id}`}
            className="block rounded-2xl border border-line bg-background p-4 transition-shadow hover:shadow-sm"
          >
            <div className="flex items-start gap-3">
              <Avatar name={c.name} size={44} />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate font-semibold leading-tight">{c.name}</p>
                  <TempPill t={c.temperature} />
                </div>
                <p className="truncate text-xs text-ink-soft">{c.title} · {c.company}</p>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className={`rounded-md px-2 py-0.5 font-semibold capitalize ${LIFE[c.lifecycle]}`}>{c.lifecycle.replace("_", " ")}</span>
              <span className="rounded-md bg-surface px-2 py-0.5 capitalize text-ink-soft">{c.stage.replace("_", " ")}</span>
              <span className="text-ink-soft">{c.vertical} · {c.location}</span>
            </div>

            <div className="mt-3 flex flex-col gap-1.5 border-t border-line pt-3 text-xs text-ink-soft">
              <span className="inline-flex items-center gap-2">
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M4 5h16v14H4zM4 7l8 6 8-6" /></svg>
                <span className="truncate">{c.email}</span>
              </span>
              <span className="inline-flex items-center gap-2">
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h4l2 5-2 1a11 11 0 005 5l1-2 5 2v4a2 2 0 01-2 2A16 16 0 014 6a2 2 0 012-2z" /></svg>
                {c.phone}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
