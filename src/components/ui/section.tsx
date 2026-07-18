import type { ReactNode } from "react";

// The eyebrow + title (+ optional description / actions) block used across command + portal.
// `Eyebrow` is also exported standalone (the uppercase-tracking label used on its own, ~66 uses).
// Deliberately conservative: with no `actions` it renders a plain block (no flex wrapper), so it's a
// drop-in for the common `<Eyebrow/><h2/><p/>` cluster without changing layout. Marketing's large
// display headings (text-4xl/5xl) are intentionally out of scope — they stay bespoke.

export function Eyebrow({ className = "", children }: { className?: string; children: ReactNode }) {
  return <p className={`text-xs font-semibold uppercase tracking-wide text-ink-soft ${className}`.trim()}>{children}</p>;
}

type HeadingSize = "sm" | "md" | "lg";

const TITLE_SIZES: Record<HeadingSize, string> = {
  sm: "text-base",
  md: "text-lg",
  lg: "text-xl",
};

export function SectionHeading({
  as = "h2",
  eyebrow,
  title,
  description,
  size = "md",
  actions,
  className = "",
}: {
  as?: "h2" | "h3";
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  size?: HeadingSize;
  actions?: ReactNode;
  className?: string;
}) {
  const Tag = as;
  const block = (
    <div>
      {eyebrow ? <Eyebrow className="mb-1.5">{eyebrow}</Eyebrow> : null}
      <Tag className={`${TITLE_SIZES[size]} font-bold tracking-tight`}>{title}</Tag>
      {description ? <p className="mt-1 text-sm text-ink-soft">{description}</p> : null}
    </div>
  );
  if (!actions) return <div className={className}>{block}</div>;
  return (
    <div className={`flex items-start justify-between gap-4 ${className}`.trim()}>
      {block}
      <div className="flex shrink-0 items-center gap-2">{actions}</div>
    </div>
  );
}
