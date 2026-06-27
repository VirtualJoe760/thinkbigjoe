import type { Metadata } from "next";
import { Sidebar } from "./_components/sidebar";
import { TopBar } from "./_components/topbar";
import { BottomNav } from "./_components/bottom-nav";

export const metadata: Metadata = {
  title: "Command Center v2 (preview)",
  robots: { index: false, follow: false },
};

export default function PreviewLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-surface">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="flex-1 px-4 py-5 pb-24 sm:px-5 md:px-8 md:py-6 md:pb-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
