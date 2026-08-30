#!/usr/bin/env node
// ---------------------------------------------------------------------------
// sync-venus-crons — reconcile the local OpenClaw cron store to match the
// manifest at src/lib/venus-crons.mjs (the source of truth).
//
//   npm run venus:sync           # apply changes
//   npm run venus:sync -- --dry  # show what would change, touch nothing
//
// Matches OpenClaw crons by NAME. For each manifest cron it will:
//   • ADD it if no cron with that name exists
//   • EDIT it if the schedule or prompt drifted from the manifest
//   • leave it untouched if already in sync
// Crons in OpenClaw whose name starts with "TBJ " but are absent from the
// manifest are flagged as ORPHANS (not deleted — you decide).
//
// Requires the `openclaw` CLI on PATH (runs on the Mac where Venus lives).
// ---------------------------------------------------------------------------

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const { VENUS_CRONS } = await import(path.join(here, "../src/lib/venus-crons.mjs"));

const DRY = process.argv.includes("--dry") || process.argv.includes("--dry-run");

function oc(args) {
  const res = spawnSync("openclaw", args, { encoding: "utf8" });
  if (res.error) {
    console.error(`✗ failed to run \`openclaw ${args.join(" ")}\`: ${res.error.message}`);
    console.error("  Is the openclaw CLI installed and on PATH? (npm i -g openclaw)");
    process.exit(1);
  }
  return res;
}

function staggerArgs(stagger) {
  if (!stagger || stagger === "exact") return ["--exact"];
  return ["--stagger", stagger];
}

// Delivery: a manifest cron with `channel` (e.g. "telegram") + `to` (chat id) announces
// its final text there — how Venus's inbox updates reach Joe. `tz` pins the cron
// expression to an IANA timezone. A cron without `channel` behaves exactly as before.
function deliveryArgs(cron) {
  const args = [];
  if (cron.channel) {
    args.push("--announce", "--channel", cron.channel, "--best-effort-deliver");
    if (cron.to) args.push("--to", String(cron.to));
  } else {
    // A worker cron (Whitney, Edward) must NEVER announce — it reports through activity_log and
    // Venus does the talking. Saying nothing here is not enough: `openclaw cron add` defaults to
    // channel "last", which FAIL-CLOSES whenever more than one channel is configured
    // ("Channel is required when multiple channels are configured: discord, telegram"). That
    // silently errored Edward's sweep 4 runs in a row while the agent work itself succeeded.
    args.push("--no-deliver");
  }
  if (cron.tz) args.push("--tz", cron.tz);
  return args;
}

// Delivery drift is invisible to a schedule/prompt/agent diff, which is exactly how Edward's cron
// sat broken. The manifest is the source of truth for delivery too.
function deliveryDrift(cron, existing) {
  const d = existing.delivery ?? {};
  if (cron.channel) {
    return d.mode !== "announce" || d.channel !== cron.channel || d.bestEffort !== true;
  }
  return d.mode === "announce" && d.channel != null;
}

// --- Load current OpenClaw state -------------------------------------------
const listRes = oc(["cron", "list", "--all", "--json"]);
let current = [];
try {
  const parsed = JSON.parse(listRes.stdout);
  current = Array.isArray(parsed) ? parsed : parsed.jobs || parsed.crons || [];
} catch (e) {
  console.error("✗ could not parse `openclaw cron list --json`:", e.message);
  console.error(listRes.stdout?.slice(0, 300));
  process.exit(1);
}
const byName = new Map(current.map((c) => [c.name, c]));

// --- Reconcile --------------------------------------------------------------
let added = 0, updated = 0, ok = 0, disabled = 0;

let skipped = 0;

for (const cron of VENUS_CRONS) {
  // A cron declared `enabled: false` is documented in the manifest but NOT synced —
  // it stays cold until someone flips the flag. Used to land a full-stack feature's
  // schedule in-repo before its prerequisites (e.g. an agent's credentials/profile)
  // are set, without it firing. Flip to true (or remove the flag) + re-sync to activate.
  if (cron.enabled === false) {
    // The manifest is the source of truth, so `enabled:false` must be able to TURN OFF a cron
    // that is already live — not merely decline to create it. Skipping was a real gap: on
    // 2026-08-28 three crons (Tom, Email Inbox, Brand Lead) were running against a manifest
    // that said they shouldn't be, and had to be disabled by hand via the CLI.
    const live = byName.get(cron.name);
    if (live && live.enabled !== false) {
      console.log(`${DRY ? "[dry] would DISABLE" : "⏸ DISABLE"} ${cron.name}  (manifest says enabled:false, but it is live)`);
      if (!DRY) {
        const res = oc(["cron", "disable", live.id]);
        if (res.status !== 0) console.error(`  ✗ disable failed: ${res.stderr || res.stdout}`);
      }
      disabled++;
    } else {
      console.log(`⏸ skip  ${cron.name}  (disabled in manifest — not synced)`);
    }
    skipped++;
    continue;
  }

  const existing = byName.get(cron.name);

  if (!existing) {
    console.log(`${DRY ? "[dry] would ADD" : "＋ ADD"}  ${cron.name}  (${cron.schedule})`);
    if (!DRY) {
      // Agent-targeted crons run AS that worker agent (--agent + --message);
      // agentless crons fire as a system event on Venus's main session.
      const payloadArgs = cron.agent
        ? ["--agent", cron.agent, "--message", cron.prompt]
        : ["--system-event", cron.prompt];
      const res = oc([
        "cron", "add",
        "--name", cron.name,
        "--cron", cron.schedule,
        ...staggerArgs(cron.stagger),
        ...deliveryArgs(cron),
        ...payloadArgs,
      ]);
      if (res.status !== 0) {
        console.error(`  ✗ add failed: ${res.stderr || res.stdout}`);
      } else {
        // surface the new id so it can be pasted back into the manifest
        const m = (res.stdout || "").match(/"id":\s*"([0-9a-f-]+)"/i);
        if (m) console.log(`     new id: ${m[1]}  → paste into venus-crons.mjs`);
      }
    }
    added++;
    continue;
  }

  const liveExpr = existing.schedule?.expr ?? "";
  // system-event crons store the prompt in payload.text; agent-turn crons in payload.message.
  const liveText = existing.payload?.message ?? existing.payload?.text ?? "";
  const liveAgent = existing.agentId ?? null;
  const scheduleDrift = liveExpr !== cron.schedule;
  const promptDrift = liveText !== cron.prompt;
  const agentDrift = (cron.agent ?? null) !== liveAgent;
  const delivDrift = deliveryDrift(cron, existing);

  if (!scheduleDrift && !promptDrift && !agentDrift && !delivDrift) {
    console.log(`✓ ok   ${cron.name}`);
    ok++;
    continue;
  }

  const what = [scheduleDrift && "schedule", promptDrift && "prompt", agentDrift && "agent", delivDrift && "delivery"].filter(Boolean).join(" + ");
  console.log(`${DRY ? "[dry] would EDIT" : "✎ EDIT"} ${cron.name}  (${what})`);
  if (scheduleDrift) console.log(`     schedule: ${liveExpr || "—"}  →  ${cron.schedule}`);
  if (!DRY) {
    const args = ["cron", "edit", existing.id];
    if (scheduleDrift) args.push("--cron", cron.schedule, ...staggerArgs(cron.stagger));
    if (promptDrift || agentDrift) {
      if (cron.agent) args.push("--agent", cron.agent, "--message", cron.prompt);
      else args.push("--system-event", cron.prompt);
    }
    args.push(...deliveryArgs(cron)); // always re-assert delivery — see deliveryDrift()
    const res = oc(args);
    if (res.status !== 0) console.error(`  ✗ edit failed: ${res.stderr || res.stdout}`);
  }
  updated++;
}

// --- Orphan check -----------------------------------------------------------
const manifestNames = new Set(VENUS_CRONS.map((c) => c.name));
const orphans = current.filter((c) => c.name?.startsWith("TBJ ") && !manifestNames.has(c.name));
for (const o of orphans) {
  console.log(`⚠ ORPHAN ${o.name}  — in OpenClaw but not in the manifest (id: ${o.id})`);
  console.log(`     remove with: openclaw cron rm ${o.id}   (or add it to venus-crons.mjs)`);
}

// --- Summary ----------------------------------------------------------------
console.log("");
console.log(
  `${DRY ? "[dry] " : ""}Sync complete — ${ok} in sync, ${updated} ${DRY ? "to update" : "updated"}, ` +
  `${added} ${DRY ? "to add" : "added"}, ${disabled} ${DRY ? "to turn off" : "turned off"}, ` +
  `${skipped} disabled/skipped, ${orphans.length} orphan(s).`,
);
if (DRY) console.log("Re-run without --dry to apply.");
