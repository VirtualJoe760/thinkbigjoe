"use client";

import { useState } from "react";

const VERTICALS = [
  { value: "insurance", label: "Insurance" },
  { value: "mortgage", label: "Mortgage" },
  { value: "wealth", label: "Wealth / Financial" },
  { value: "msp", label: "MSP / IT" },
  { value: "law", label: "Law Firms" },
  { value: "other", label: "Other" },
];

type Status = "idle" | "loading" | "done" | "error";

export function ScoutForm() {
  const [vertical, setVertical] = useState("insurance");
  const [location, setLocation] = useState("");
  const [sources, setSources] = useState<string[]>(["google_maps", "yelp"]);
  const [limit, setLimit] = useState(20);
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<{ inserted: number; skipped: number } | null>(null);
  const [error, setError] = useState("");

  function toggleSource(src: string) {
    setSources((prev) =>
      prev.includes(src) ? prev.filter((s) => s !== src) : [...prev, src]
    );
  }

  async function run() {
    if (!location.trim()) return;
    setStatus("loading");
    setResult(null);
    setError("");
    try {
      const res = await fetch("/api/scout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vertical, location: location.trim(), sources, limit }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Scout failed");
      setResult(data);
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setStatus("error");
    }
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <h2 className="text-sm font-semibold tracking-tight">Scout new prospects</h2>
      <p className="mt-1 text-xs text-ink-soft">
        Search Google Maps and Yelp for local businesses. Results land in the review queue below.
      </p>

      <div className="mt-4 flex flex-wrap gap-3">
        {/* Vertical */}
        <select
          value={vertical}
          onChange={(e) => setVertical(e.target.value)}
          className="rounded-lg border border-line bg-background px-3 py-2 text-sm focus:border-brand focus:outline-none"
        >
          {VERTICALS.map((v) => (
            <option key={v.value} value={v.value}>{v.label}</option>
          ))}
        </select>

        {/* Location */}
        <input
          type="text"
          placeholder="City, State (e.g. Phoenix, AZ)"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          className="min-w-[200px] flex-1 rounded-lg border border-line bg-background px-3 py-2 text-sm focus:border-brand focus:outline-none"
        />

        {/* Limit */}
        <select
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
          className="rounded-lg border border-line bg-background px-3 py-2 text-sm focus:border-brand focus:outline-none"
        >
          {[10, 20, 30, 50].map((n) => (
            <option key={n} value={n}>{n} results</option>
          ))}
        </select>
      </div>

      {/* Sources */}
      <div className="mt-3 flex items-center gap-4">
        {[
          { id: "google_maps", label: "Google Maps" },
          { id: "yelp", label: "Yelp" },
        ].map(({ id, label }) => (
          <label key={id} className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={sources.includes(id)}
              onChange={() => toggleSource(id)}
              className="accent-brand"
            />
            {label}
          </label>
        ))}
        <button
          onClick={run}
          disabled={status === "loading" || sources.length === 0 || !location.trim()}
          className="ml-auto rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "loading" ? "Searching…" : "Run scout"}
        </button>
      </div>

      {/* Result */}
      {status === "done" && result && (
        <p className="mt-3 text-sm text-ink-soft">
          ✓ Added <strong className="text-ink">{result.inserted}</strong> new prospects
          {result.skipped > 0 && `, skipped ${result.skipped} duplicates`}.
          Refresh the queue below to review them.
        </p>
      )}
      {status === "error" && (
        <p className="mt-3 text-sm text-red-500">{error}</p>
      )}
    </div>
  );
}
