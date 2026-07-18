import type { ComponentPropsWithoutRef, ReactNode } from "react";

// Shared surface primitive — replaces the ~159 inline `rounded-{xl,2xl} border border-line
// bg-{background,surface} p-*` copies across the app. A card and the smaller inset "panel" are the
// SAME surface at two radii, so this is ONE component with a `radius` prop, never two. Tokens only;
// introduces no new colors. `cardClass()` is the className-only lever for migrating a surface
// without a JSX rewrite (mirrors buttonClass()).

type Radius = "xl" | "2xl";
type Tone = "base" | "surface";
type Padding = "none" | "sm" | "md" | "lg" | "xl";

const RADII: Record<Radius, string> = {
  xl: "rounded-xl",
  "2xl": "rounded-2xl",
};

const TONES: Record<Tone, string> = {
  base: "bg-background",
  surface: "bg-surface",
};

const PADDING: Record<Padding, string> = {
  none: "",
  sm: "p-4",
  md: "p-5",
  lg: "p-6",
  xl: "p-8",
};

type CardStyleProps = {
  radius?: Radius;
  tone?: Tone;
  padding?: Padding;
  className?: string;
};

export function cardClass({
  radius = "2xl",
  tone = "base",
  padding = "md",
  className = "",
}: CardStyleProps = {}): string {
  return `border border-line ${RADII[radius]} ${TONES[tone]} ${PADDING[padding]} ${className}`.trim();
}

export function Card({
  radius,
  tone,
  padding,
  className,
  children,
  ...rest
}: CardStyleProps & ComponentPropsWithoutRef<"div">) {
  return (
    <div className={cardClass({ radius, tone, padding, className })} {...rest}>
      {children}
    </div>
  );
}
