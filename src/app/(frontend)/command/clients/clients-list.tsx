"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

export type Client = {
  siteId: number;
  businessName: string;
  ownerName: string | null;
  ownerEmail: string | null;
  accountNumber: string | null;
  plan: string | null;
  subscriptionStatus: string | null;
  paid: boolean;
  phone: string | null;
  siteUrl: string | null;
  domain: string | null;
  domainStatus: string | null;
  receptionistStatus: string | null;
  claimedAt: string | null;
};

function initials(name: string): string {
  const words = (name || "?").split(/\s+/).filter(Boolean).slice(0, 2);
  return words.map((w) => (Array.from(w).find((c) => /\p{L}|\p{N}/u.test(c)) || "").toUpperCase()).join("") || "?";
}
function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
}

export function ClientsList({ clients }: { clients: Client[] }) {
  const [q, setQ] = useState("");
  const [payingOnly, setPayingOnly] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const digits = needle.replace(/\D/g, "");
    return clients.filter((c) => {
      if (payingOnly && !c.paid) return false;
      if (!needle) return true;
      const text = [c.businessName, c.ownerName, c.ownerEmail, c.plan, c.accountNumber].filter(Boolean).some((v) => v!.toLowerCase().includes(needle));
      const phone = digits.length >= 3 && (c.phone || "").replace(/\D/g, "").includes(digits);
      return text || phone;
    });
  }, [clients, q, payingOnly]);

  const payingCount = clients.filter((c) => c.paid).length;

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-extrabold tracking-tight">Clients</h1>
        <p className="mt-0.5 text-sm text-ink-soft">
          Everyone who claimed their site + signed up. <span className="font-semibold text-ink">{payingCount}</span> paying · {clients.length} total.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, business, email, account #, phone…"
          className="min-w-0 flex-1 rounded-full border border-line bg-surface px-4 py-2 text-sm text-ink outline-none placeholder:text-ink-soft focus:border-brand"
        />
        <button
          onClick={() => setPayingOnly((v) => !v)}
          className={`shrink-0 rounded-full border px-3 py-2 text-xs font-semibold transition-colors ${payingOnly ? "border-brand bg-brand text-white" : "border-line bg-background text-ink-soft hover:bg-surface"}`}
        >
          Paying only
        </button>
      </div>

      {filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-ink-soft">No clients match.</p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line">
          {filtered.map((c) => {
            const open = openId === c.siteId;
            return (
              <div key={c.siteId} className="border-b border-line last:border-b-0">
                <button onClick={() => setOpenId(open ? null : c.siteId)} className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-surface">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand/10 text-sm font-bold text-brand">{initials(c.businessName)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">{c.businessName}</span>
                    <span className="block truncate text-xs text-ink-soft">{[c.ownerName, c.ownerEmail].filter(Boolean).join(" · ") || "—"}</span>
                  </span>
                  {c.accountNumber && <span className="hidden shrink-0 rounded-full border border-line bg-surface px-2 py-0.5 font-mono text-[11px] tabular-nums text-ink-soft sm:inline">#{c.accountNumber}</span>}
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${c.paid ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{c.paid ? c.plan || "Paying" : "Not paid"}</span>
                </button>

                {open && (
                  <div className="border-t border-line bg-surface/40 px-4 py-3 text-sm">
                    <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5">
                      <dt className="text-ink-soft">Account #</dt><dd className="font-mono tabular-nums">{c.accountNumber || "—"}</dd>
                      <dt className="text-ink-soft">Plan</dt><dd>{c.plan || "—"}{c.subscriptionStatus ? ` · ${c.subscriptionStatus.replace(/_/g, " ")}` : ""}</dd>
                      <dt className="text-ink-soft">Email</dt><dd className="min-w-0 truncate">{c.ownerEmail ? <a href={`mailto:${c.ownerEmail}`} className="text-brand hover:underline">{c.ownerEmail}</a> : "—"}</dd>
                      <dt className="text-ink-soft">Phone</dt><dd>{c.phone ? <a href={`tel:${c.phone.replace(/[^0-9+]/g, "")}`} className="text-brand hover:underline">{c.phone}</a> : "—"}</dd>
                      <dt className="text-ink-soft">Site</dt><dd className="min-w-0 truncate">{c.siteUrl ? <a href={c.siteUrl} target="_blank" rel="noreferrer" className="text-brand hover:underline">{c.domain || c.siteUrl.replace(/^https?:\/\//, "")}</a> : "—"}{c.domainStatus && c.domainStatus !== "live" ? <span className="text-ink-soft"> · {c.domainStatus}</span> : ""}</dd>
                      <dt className="text-ink-soft">Receptionist</dt><dd>{c.receptionistStatus || "—"}</dd>
                      <dt className="text-ink-soft">Client since</dt><dd>{fmtDate(c.claimedAt) || "—"}</dd>
                    </dl>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link href="/command/messages" className="rounded-full border border-line bg-background px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand-tint/40">Messages ↗</Link>
                      <Link href="/command/leads" className="rounded-full border border-line bg-background px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface">Lead record ↗</Link>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
