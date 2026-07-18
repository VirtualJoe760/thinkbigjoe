import type { ReactNode } from "react";

// Metric tile (label + big number + optional sub) and its responsive grid. Replaces the ~16 files
// that hand-roll `rounded-xl bg-surface p-4` tiles with a `text-3xl font-extrabold` number. Value is
// `tabular-nums` by default (metrics align); `accent` flips it to the brand color.

type StatTone = "surface" | "bordered";

const STAT_TONES: Record<StatTone, string> = {
  surface: "rounded-xl bg-surface p-4",
  bordered: "rounded-2xl border border-line bg-background p-5",
};

export function StatTile({
  label,
  value,
  sub,
  accent = false,
  tone = "surface",
  className = "",
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  accent?: boolean;
  tone?: StatTone;
  className?: string;
}) {
  return (
    <div className={`${STAT_TONES[tone]} ${className}`.trim()}>
      <p className="text-sm text-ink-soft">{label}</p>
      <p className={`mt-1 text-3xl font-extrabold tracking-tight tabular-nums ${accent ? "text-brand" : ""}`.trim()}>
        {value}
      </p>
      {sub ? <p className="mt-1 text-xs text-ink-soft">{sub}</p> : null}
    </div>
  );
}

type Cols = 2 | 3 | 4;

const GRID_COLS: Record<Cols, string> = {
  2: "grid-cols-2",
  3: "grid-cols-2 md:grid-cols-3",
  4: "grid-cols-2 md:grid-cols-4",
};

export function StatGrid({ cols = 3, className = "", children }: { cols?: Cols; className?: string; children: ReactNode }) {
  return <div className={`grid gap-3 ${GRID_COLS[cols]} ${className}`.trim()}>{children}</div>;
}
