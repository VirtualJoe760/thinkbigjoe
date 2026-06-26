import Link from "next/link";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

// Shared button primitive — replaces the ~14 inline `rounded-full bg-brand …`
// copies across the app. Use <Button> for actions, <ButtonLink> for navigation.
// Sizes md/lg carry a 44px min tap target for mobile.

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const BASE =
  "inline-flex items-center justify-center rounded-full font-semibold transition-colors " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 " +
  "disabled:opacity-50 disabled:pointer-events-none";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand text-white hover:bg-brand-dark",
  secondary: "border border-line bg-background text-ink hover:bg-surface",
  ghost: "text-ink-soft hover:bg-surface hover:text-ink",
  danger: "bg-red-600 text-white hover:bg-red-700",
};

const SIZES: Record<Size, string> = {
  sm: "gap-1.5 px-3 py-1.5 text-xs",
  md: "min-h-11 gap-2 px-4 py-2.5 text-sm",
  lg: "min-h-12 gap-2 px-6 py-3 text-base",
};

type StyleProps = {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  className?: string;
  children: ReactNode;
};

export function buttonClass({
  variant = "primary",
  size = "md",
  fullWidth = false,
  className = "",
}: Omit<StyleProps, "children">): string {
  return `${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${fullWidth ? "w-full" : ""} ${className}`.trim();
}

export function Button({
  variant,
  size,
  fullWidth,
  className,
  children,
  ...rest
}: StyleProps & ComponentPropsWithoutRef<"button">) {
  return (
    <button className={buttonClass({ variant, size, fullWidth, className })} {...rest}>
      {children}
    </button>
  );
}

export function ButtonLink({
  variant,
  size,
  fullWidth,
  className,
  children,
  ...rest
}: StyleProps & ComponentPropsWithoutRef<typeof Link>) {
  return (
    <Link className={buttonClass({ variant, size, fullWidth, className })} {...rest}>
      {children}
    </Link>
  );
}
