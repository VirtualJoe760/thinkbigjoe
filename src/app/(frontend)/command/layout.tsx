import { requireAdmin } from "@/lib/require-admin";
import { CommandHeader } from "./command-header";

export default async function CommandLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { email } = await requireAdmin();

  return (
    <div className="flex min-h-full flex-col">
      <CommandHeader email={email} />
      <main className="flex-1">{children}</main>
    </div>
  );
}
