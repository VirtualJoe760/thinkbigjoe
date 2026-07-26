import type { Metadata } from "next";
import { sql } from "drizzle-orm";

import { db } from "@/db";
import { requireAdmin } from "@/lib/require-admin";
import { smsAgentModel } from "@/lib/sms-agent";
import { AGENT_MODELS } from "./models";
import { AgentsConsole, type ProspectOption } from "./agents-console";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Agents",
  robots: { index: false, follow: false },
};

/**
 * The Agents console — a live bench for the SMS communications agent, the one agent that talks
 * directly to customers. Pick any prospect (so it loads their real facts + name), pick a model,
 * and have a real conversation with the exact brain that answers texts. Throw it the hardest
 * objections and watch it work before it ever goes near a real lead. Admin-only.
 */
export default async function AgentsPage() {
  await requireAdmin();

  // A working set of prospects to role-play as — prefer ones we've actually texted or that have
  // real enrichment on file, so the agent has something specific to work with.
  const rows = (
    await db.execute(sql`
      SELECT id, business_name AS name, niche, city, owner_name AS owner,
             (contact_notes IS NOT NULL OR call_prep IS NOT NULL) AS enriched
      FROM forge_sites
      WHERE status <> 'deleted' AND phone IS NOT NULL
      ORDER BY (contact_notes IS NOT NULL OR call_prep IS NOT NULL) DESC, contacted_at DESC NULLS LAST, updated_at DESC
      LIMIT 60`)
  ).rows as Array<{ id: number; name: string; niche: string | null; city: string | null; owner: string | null; enriched: boolean }>;

  const prospects: ProspectOption[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    niche: r.niche,
    city: r.city,
    owner: r.owner,
    enriched: r.enriched,
  }));

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-ink">Agents console</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Talk to the SMS sales agent live — the same brain that answers real leads. Pick who it thinks it&apos;s
          texting, pick a model, and pressure-test it. Nothing here sends a real message.
        </p>
        <p className="mt-1 text-xs text-ink-soft">
          Live default: <span className="font-mono text-ink">{smsAgentModel()}</span>
        </p>
      </div>
      <AgentsConsole prospects={prospects} models={[...AGENT_MODELS]} />
    </div>
  );
}
