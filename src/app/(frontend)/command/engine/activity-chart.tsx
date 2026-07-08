import type { ActivityPoint } from "@/lib/forge-stats";

/**
 * 14-day forge throughput — stacked bars (builds + edits + outreach per day).
 * Pure SVG, no deps. Server-rendered from the digest series.
 */
const SERIES = [
  { key: "builds" as const, label: "Builds", color: "#2563eb" },
  { key: "edits" as const, label: "Edits", color: "#16a34a" },
  { key: "outreach" as const, label: "Outreach", color: "#d97706" },
];

export function ActivityChart({ data }: { data: ActivityPoint[] }) {
  const W = 700;
  const H = 180;
  const padL = 24;
  const padB = 22;
  const padT = 8;
  const chartW = W - padL - 8;
  const chartH = H - padB - padT;
  const totals = data.map((d) => d.builds + d.edits + d.outreach);
  const max = Math.max(4, ...totals);
  const step = chartW / Math.max(1, data.length);
  const barW = Math.min(28, step * 0.62);
  const scaleY = (v: number) => (v / max) * chartH;

  const gridVals = [0, Math.ceil(max / 2), max];

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 520 }} role="img" aria-label="14-day forge activity">
        {/* gridlines */}
        {gridVals.map((gv) => {
          const y = padT + chartH - scaleY(gv);
          return (
            <g key={gv}>
              <line x1={padL} y1={y} x2={W - 8} y2={y} stroke="currentColor" strokeOpacity={0.1} strokeWidth={1} />
              <text x={padL - 6} y={y + 3} textAnchor="end" fontSize={9} fill="currentColor" fillOpacity={0.45}>
                {gv}
              </text>
            </g>
          );
        })}
        {/* bars */}
        {data.map((d, i) => {
          const x = padL + i * step + (step - barW) / 2;
          let yCursor = padT + chartH;
          const day = d.date.slice(8, 10);
          return (
            <g key={d.date}>
              {SERIES.map((s) => {
                const h = scaleY(d[s.key]);
                if (h <= 0) return null;
                yCursor -= h;
                return <rect key={s.key} x={x} y={yCursor} width={barW} height={h} fill={s.color} rx={1.5} />;
              })}
              {(i % 2 === 0 || i === data.length - 1) && (
                <text x={x + barW / 2} y={H - 7} textAnchor="middle" fontSize={9} fill="currentColor" fillOpacity={0.45}>
                  {day}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex flex-wrap items-center gap-4 px-1 text-xs text-ink-soft">
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
            {s.label}
          </span>
        ))}
        <span className="ml-auto text-[11px]">last 14 days</span>
      </div>
    </div>
  );
}
