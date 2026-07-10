"use client";

import { useState } from "react";
import Link from "next/link";

import { ImageStudio } from "./image-studio";
import { TemplateGallery } from "./template-gallery";

type Tab = "site" | "studio" | "design";

const TABS: { key: Tab; label: string; short: string; icon: string }[] = [
  { key: "site", label: "Site", short: "Site", icon: "✏️" },
  { key: "studio", label: "🎨 Studio", short: "Studio", icon: "🎨" },
  { key: "design", label: "🖼 Design", short: "Design", icon: "🖼" },
];

export function EditWorkspace({
  siteId,
  liveUrl,
  businessName,
  currentTemplate,
  initialTab = "site",
}: {
  siteId: number;
  liveUrl: string | null;
  businessName: string;
  currentTemplate: string | null;
  initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-line bg-background px-5 py-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wide text-brand uppercase">Live edit mode</p>
          <p className="truncate text-sm font-bold tracking-tight">{businessName}</p>
        </div>

        {/* Desktop: pill switcher in the header. On phones this hides — the bottom bar takes over. */}
        <div className="hidden rounded-full bg-surface p-1 md:inline-flex">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${tab === t.key ? "bg-ink text-white" : "text-ink-soft hover:text-ink"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <Link
          href="/portal"
          className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface"
        >
          Done
        </Link>
      </header>

      {tab === "design" ? (
        <TemplateGallery siteId={siteId} current={currentTemplate} />
      ) : tab === "studio" ? (
        <ImageStudio siteId={siteId} />
      ) : liveUrl ? (
        <iframe
          src={`/api/site-proxy/${siteId}`}
          title={`${businessName} — edit`}
          className="min-h-0 flex-1 border-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock"
        />
      ) : (
        <div className="flex flex-1 items-center justify-center p-8 text-center text-ink-soft">
          Your site isn&apos;t live yet — check back once it&apos;s built.
        </div>
      )}

      {/* Mobile: thumb-reachable bottom tab bar (in-flow, so content sits above it). */}
      <nav
        className="flex border-t border-line bg-background md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            aria-current={tab === t.key ? "page" : undefined}
            className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-2.5 text-xs font-semibold transition-colors ${tab === t.key ? "text-brand" : "text-ink-soft"}`}
          >
            <span className="text-lg leading-none" aria-hidden>{t.icon}</span>
            {t.short}
          </button>
        ))}
      </nav>
    </div>
  );
}
