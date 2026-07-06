"use client";

import { useState } from "react";
import Link from "next/link";

import { ImageStudio } from "./image-studio";

export function EditWorkspace({
  siteId,
  liveUrl,
  businessName,
}: {
  siteId: number;
  liveUrl: string | null;
  businessName: string;
}) {
  const [tab, setTab] = useState<"site" | "studio">("site");

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-line bg-background px-5 py-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wide text-brand uppercase">Live edit mode</p>
          <p className="truncate text-sm font-bold tracking-tight">{businessName}</p>
        </div>

        <div className="inline-flex rounded-full bg-surface p-1">
          <button
            onClick={() => setTab("site")}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${tab === "site" ? "bg-ink text-white" : "text-ink-soft hover:text-ink"}`}
          >
            Site
          </button>
          <button
            onClick={() => setTab("studio")}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${tab === "studio" ? "bg-ink text-white" : "text-ink-soft hover:text-ink"}`}
          >
            🎨 Studio
          </button>
        </div>

        <Link
          href="/portal"
          className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface"
        >
          Done
        </Link>
      </header>

      {tab === "studio" ? (
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
    </div>
  );
}
