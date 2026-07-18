"use client";

import { useState } from "react";
import type { SiteAnalysis } from "@/lib/site-analyzer";
import { Card, cardClass } from "@/components/ui";

export type AnalysisRow = {
  id: number;
  url: string;
  status: string;
  businessName: string | null;
  analysis: SiteAnalysis | null;
  createdAt: string;
};
export type RebuildRow = {
  id: number;
  existingUrl: string;
  businessName: string | null;
  email: string | null;
  status: string;
  createdAt: string;
};

export function Analyzer({
  initialAnalyses,
  rebuildRequests,
}: {
  initialAnalyses: AnalysisRow[];
  rebuildRequests: RebuildRow[];
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [current, setCurrent] = useState<SiteAnalysis | null>(initialAnalyses[0]?.analysis || null);
  const [analyses, setAnalyses] = useState<AnalysisRow[]>(initialAnalyses);

  async function run(target: string, rebuildRequestId?: number) {
    const u = target.trim();
    if (!u) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/analyze-site", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: u, rebuildRequestId }),
      }).then((r) => r.json());
      if (res.analysis) {
        setCurrent(res.analysis);
        if (res.id) {
          setAnalyses((prev) => [
            {
              id: res.id,
              url: res.analysis.url,
              status: res.ok ? "analyzed" : "failed",
              businessName: res.analysis.business?.name || null,
              analysis: res.analysis,
              createdAt: new Date().toISOString(),
            },
            ...prev,
          ]);
        }
      }
      if (!res.ok) setError(res.error || "Couldn't analyze that site.");
    } catch {
      setError("Request failed.");
    }
    setBusy(false);
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(url);
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste an existing website URL (e.g. acmeplumbing.com)"
          className="min-w-0 flex-1 rounded-full border border-line bg-background px-4 py-2.5 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-full bg-brand px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-50"
        >
          {busy ? "Analyzing…" : "Analyze site"}
        </button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}

      {current && <AnalysisCard a={current} />}

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">
            Rebuild requests <span className="ml-1 text-ink">{rebuildRequests.length}</span>
          </h2>
          <p className="mt-1 text-xs text-ink-soft">Owners who asked us to rebuild their existing site.</p>
          <div className="mt-3 space-y-2">
            {rebuildRequests.length === 0 && <p className="text-sm text-ink-soft">None yet.</p>}
            {rebuildRequests.map((r) => (
              <div key={r.id} className={cardClass({ radius: "xl", padding: "none", className: "flex items-center justify-between gap-2 p-3" })}>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-ink">{r.businessName || r.existingUrl}</div>
                  <a href={r.existingUrl} target="_blank" rel="noreferrer" className="truncate text-xs text-brand underline">
                    {r.existingUrl}
                  </a>
                  {r.status !== "requested" && (
                    <span className="ml-2 rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold text-ink-soft">{r.status}</span>
                  )}
                </div>
                <button
                  disabled={busy}
                  onClick={() => run(r.existingUrl, r.id)}
                  className="shrink-0 rounded-full border border-line px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-surface disabled:opacity-50"
                >
                  Analyze
                </button>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">
            Recent analyses <span className="ml-1 text-ink">{analyses.length}</span>
          </h2>
          <p className="mt-1 text-xs text-ink-soft">Click one to view what we pulled.</p>
          <div className="mt-3 space-y-2">
            {analyses.length === 0 && <p className="text-sm text-ink-soft">Nothing analyzed yet.</p>}
            {analyses.map((r) => (
              <button
                key={r.id}
                onClick={() => r.analysis && setCurrent(r.analysis)}
                className={cardClass({ radius: "xl", padding: "none", className: "flex w-full items-center justify-between gap-2 p-3 text-left transition-colors hover:border-brand" })}
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-ink">{r.businessName || r.url}</div>
                  <div className="truncate text-xs text-ink-soft">{r.url}</div>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    r.status === "analyzed" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-700"
                  }`}
                >
                  {r.status}
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function AnalysisCard({ a }: { a: SiteAnalysis }) {
  const b = a.business;
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            {a.brand.logoUrl && (
              <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-[repeating-conic-gradient(#eef2f7_0%_25%,#f8fafc_0%_50%)] bg-[length:12px_12px]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.brand.logoUrl} alt="logo" className="h-full w-full object-contain p-1" />
              </span>
            )}
            <div className="min-w-0">
              <h3 className="truncate text-lg font-bold text-ink">{b.name || "(no name found)"}</h3>
              <a href={a.finalUrl} target="_blank" rel="noreferrer" className="truncate text-xs text-brand underline">
                {a.finalUrl}
              </a>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          {a.meta.platform && <Tag>{a.meta.platform}</Tag>}
          {b.niche && <Tag>{b.niche}</Tag>}
          <Tag>{a.meta.pagesFetched.length} page(s)</Tag>
        </div>
      </div>

      {b.description && <p className="mt-3 text-sm text-ink-soft">{b.description}</p>}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Contact">
          <Line k="Phone" v={b.phone} />
          <Line k="Email" v={b.email} />
          <Line k="Address" v={b.address} />
          <Line k="Hours" v={b.hours} />
          <Line k="Tone" v={b.tone} />
        </Field>

        <Field label="Brand">
          {a.brand.colors.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {a.brand.colors.map((c) => (
                <span key={c} className="flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-[11px]">
                  <span className="h-3.5 w-3.5 rounded-full border border-line" style={{ background: c }} />
                  {c}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-ink-soft">No inline colors found{a.brand.suggestedBrandColor ? ` — suggested ${a.brand.suggestedBrandColor}` : ""}.</p>
          )}
          {a.brand.fonts.length > 0 && <div className="mt-2 text-xs text-ink-soft">Fonts: {a.brand.fonts.join(", ")}</div>}
          {a.socials.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {a.socials.map((s) => (
                <a key={s.label} href={s.url} target="_blank" rel="noreferrer" className="text-xs font-medium text-brand underline">
                  {s.label} ↗
                </a>
              ))}
            </div>
          )}
        </Field>
      </div>

      {b.services.length > 0 && (
        <Field label="Services" className="mt-4">
          <div className="flex flex-wrap gap-1.5">
            {b.services.map((s) => (
              <span key={s} className="rounded-full bg-brand-tint px-2.5 py-1 text-xs font-medium text-ink">{s}</span>
            ))}
          </div>
        </Field>
      )}
      {b.differentiators.length > 0 && (
        <Field label="Selling points" className="mt-4">
          <ul className="list-inside list-disc text-sm text-ink-soft">
            {b.differentiators.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </Field>
      )}

      {(a.media.hero || a.media.images.length > 0) && (
        <Field label="Media" className="mt-4">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {[a.media.hero, ...a.media.images.filter((i) => i !== a.media.hero)]
              .filter(Boolean)
              .slice(0, 12)
              .map((src, i) => (
                <a
                  key={i}
                  href={src as string}
                  target="_blank"
                  rel="noreferrer"
                  className="relative block aspect-video overflow-hidden rounded-lg border border-line bg-surface"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src as string} alt="" className="h-full w-full object-cover" />
                  {i === 0 && a.media.hero && (
                    <span className="absolute left-1 top-1 rounded bg-ink/70 px-1.5 py-0.5 text-[9px] font-semibold text-white">hero</span>
                  )}
                </a>
              ))}
          </div>
        </Field>
      )}
    </Card>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full border border-line bg-surface px-2 py-0.5 font-medium text-ink-soft">{children}</span>;
}
function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="text-xs font-bold uppercase tracking-wide text-ink-soft">{label}</div>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
function Line({ k, v }: { k: string; v?: string }) {
  if (!v) return null;
  return (
    <div className="text-sm">
      <span className="text-ink-soft">{k}: </span>
      <span className="text-ink">{v}</span>
    </div>
  );
}
