import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { RebuildForm } from "./rebuild-form";

export const metadata: Metadata = {
  title: "Rebuild my site",
};

export default async function RebuildPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login?redirect=/portal/rebuild");

  return (
    <div className="flex flex-1 flex-col">

      <main className="mx-auto w-full max-w-xl flex-1 px-6 py-12">
        <p className="text-sm font-semibold tracking-wide text-brand uppercase">
          Rebuild my site
        </p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">
          Already have a website? We'll rebuild it.
        </h1>
        <p className="mt-3 text-ink-soft">
          Drop in your current site's address and we'll crawl it, then rebuild it
          faster and better inside our ecosystem — hosting, AI receptionist, and
          all. You'll review it before anything goes live.
        </p>

        <div className="mt-8">
          <RebuildForm />
        </div>
      </main>
    </div>
  );
}
