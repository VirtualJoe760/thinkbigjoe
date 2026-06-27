import type { Temp } from "../_lib/data";

const TEMP: Record<Temp, { label: string; cls: string }> = {
  cold: { label: "Cold", cls: "bg-sky-50 text-sky-600" },
  warm: { label: "Warm", cls: "bg-amber-50 text-amber-600" },
  hot: { label: "Hot", cls: "bg-rose-50 text-rose-600" },
};

export function TempPill({ t, className = "" }: { t: Temp; className?: string }) {
  const s = TEMP[t];
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ${s.cls} ${className}`}>
      {s.label}
    </span>
  );
}

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const initials = name.split(" ").map((n) => n[0]).slice(0, 2).join("");
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full bg-brand-tint font-semibold text-brand"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials}
    </span>
  );
}

export function OwnerTag({ owner }: { owner: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-ink-soft">
      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2}>
        <path d="M9 2h6M12 4v2M5 8h14v11H5zM9 13h.01M15 13h.01" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {owner}
    </span>
  );
}

export function HealthDot({ health }: { health?: "good" | "watch" | "risk" }) {
  const c = health === "risk" ? "bg-rose-500" : health === "watch" ? "bg-amber-500" : "bg-emerald-500";
  return <span className={`inline-block h-2 w-2 rounded-full ${c}`} />;
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-line bg-background p-5 ${className}`}>{children}</div>
  );
}

export function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-ink-soft">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}
