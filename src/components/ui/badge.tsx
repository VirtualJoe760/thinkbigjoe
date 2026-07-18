import type { ReactNode } from "react";

// Two disjoint pill primitives:
//  • Badge — a static label pill. Purely presentational (NO hover) so it never reads as, or
//    collides with, a Button. Replaces ~30 ad-hoc label pills.
//  • StatusPill — a data-driven colored state pill with ONE canonical tone vocabulary. Replaces
//    ~25 status pills and collapses the ~6 duplicated `Record<string,string>` color maps scattered
//    across the CRM (sites-queue, leads-crm, outreach-card, design-reports, template-manager,
//    messages-client) — callers keep only their thin `status → tone` mapping.

type BadgeTone = "neutral" | "brand" | "outline";
type BadgeSize = "sm" | "md";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "bg-surface text-ink-soft",
  brand: "bg-brand-tint text-brand",
  outline: "border border-line text-ink-soft",
};

const BADGE_SIZES: Record<BadgeSize, string> = {
  sm: "px-2 py-0.5 text-xs",
  md: "px-3 py-1 text-xs",
};

type BadgeStyleProps = { tone?: BadgeTone; size?: BadgeSize; uppercase?: boolean; className?: string };

export function badgeClass({ tone = "neutral", size = "sm", uppercase = false, className = "" }: BadgeStyleProps = {}): string {
  return `inline-flex items-center gap-1 rounded-full font-semibold ${BADGE_TONES[tone]} ${BADGE_SIZES[size]} ${uppercase ? "uppercase tracking-wide" : ""} ${className}`.trim();
}

export function Badge({ tone, size, uppercase, className, children }: BadgeStyleProps & { children: ReactNode }) {
  return <span className={badgeClass({ tone, size, uppercase, className })}>{children}</span>;
}

// The single source of truth for state colors. Uses Tailwind's default palette (already in use by
// the ad-hoc pills this replaces) — deliberately NOT the brand tokens.
type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

const STATUS_TONES: Record<StatusTone, string> = {
  success: "bg-green-50 text-green-700",
  warning: "bg-amber-50 text-amber-700",
  danger: "bg-red-50 text-red-700",
  info: "bg-blue-50 text-blue-700",
  neutral: "bg-surface text-ink-soft",
};

export function StatusPill({ tone, icon, className = "", children }: { tone: StatusTone; icon?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_TONES[tone]} ${className}`.trim()}>
      {icon}
      {children}
    </span>
  );
}
