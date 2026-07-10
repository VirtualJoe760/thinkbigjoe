"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The major parts of a customer's portal, for the mobile PWA bottom bar.
const ITEMS = [
  { href: "/portal", label: "Home", icon: "M3 12l9-9 9 9M5 10v10h14V10" },
  { href: "/portal/book", label: "Book", icon: "M8 2v4M16 2v4M3 9h18M5 5h14v16H5z" },
  { href: "/portal/billing", label: "Billing", icon: "M3 6h18v12H3zM3 10h18M6 15h4" },
  { href: "/portal/account", label: "Account", icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM4 20a8 8 0 0116 0" },
];

// Full-screen tools own the whole viewport — the bottom bar would fight their layout.
const HIDE_ON = ["/portal/edit", "/portal/receptionist"];

/** Fixed mobile bottom bar guiding a signed-in customer through the portal's major parts.
 *  Mobile only (md:hidden); hidden on full-screen tool routes; safe-area aware for standalone PWA. */
export function PortalBottomNav() {
  const path = usePathname();
  if (HIDE_ON.some((p) => path === p || path.startsWith(p + "/"))) return null;
  const isOn = (href: string) => (href === "/portal" ? path === "/portal" : path.startsWith(href));

  return (
    <>
      {/* Spacer so page content can scroll clear of the fixed bar (mobile only). */}
      <div aria-hidden className="h-[calc(3.75rem+env(safe-area-inset-bottom))] md:hidden" />
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-background/95 backdrop-blur md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Portal"
      >
        <div className="mx-auto flex max-w-md items-stretch">
          {ITEMS.map((it) => {
            const on = isOn(it.href);
            return (
              <Link
                key={it.href}
                href={it.href}
                aria-current={on ? "page" : undefined}
                className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium transition-colors ${on ? "text-brand" : "text-ink-soft"}`}
              >
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={on ? 2.2 : 1.7} strokeLinecap="round" strokeLinejoin="round">
                  <path d={it.icon} />
                </svg>
                {it.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
