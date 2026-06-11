import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-background">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-12 md:flex-row md:items-center md:justify-between">
        <div>
          <Link href="/" className="flex items-center gap-2 font-bold">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-ink text-[13px] font-extrabold text-white">
              T
            </span>
            <span className="text-lg">
              Think<span className="text-brand">Big</span>Joe
            </span>
          </Link>
          <p className="mt-3 max-w-xs text-sm text-ink-soft">
            Agentic AI & MCP development for businesses ready to think big.
          </p>
        </div>

        <div className="flex flex-col gap-2 text-sm text-ink-soft sm:flex-row sm:gap-8">
          <Link href="#services" className="hover:text-ink">
            Services
          </Link>
          <Link href="#approach" className="hover:text-ink">
            Approach
          </Link>
          <Link href="/login" className="hover:text-ink">
            Client Login
          </Link>
          <Link href="#contact" className="hover:text-ink">
            Contact
          </Link>
        </div>
      </div>
      <div className="border-t border-line">
        <div className="mx-auto max-w-6xl px-6 py-6 text-xs text-ink-soft">
          © {new Date().getFullYear()} ThinkBigJoe. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
