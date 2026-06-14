import { requireAdmin } from "@/lib/require-admin";
import { Logo } from "@/components/logo";
import { CommandNav } from "./nav";
import { SignOut } from "./sign-out";

export default async function CommandLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { email } = await requireAdmin();

  return (
    <div className="flex flex-1 flex-col md:flex-row">
      <aside className="flex flex-shrink-0 flex-col gap-6 border-b border-line bg-background px-4 py-6 md:w-60 md:border-b-0 md:border-r">
        <div className="px-2">
          <Logo />
        </div>
        <CommandNav />
        <div className="mt-auto flex flex-col gap-1 px-2 pt-4 text-xs text-ink-soft">
          <span className="truncate">{email}</span>
          <div className="flex items-center gap-3">
            <a href="/" className="hover:text-ink">
              Site
            </a>
            <SignOut />
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
