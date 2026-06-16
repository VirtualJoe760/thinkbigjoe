#!/usr/bin/env node
/**
 * ThinkBigJoe — Cowork runner (Mac Mini).
 *
 * Long-running poller. Claims queued jobs from the site's queue API and runs
 * each one by invoking Claude Code headless (`claude -p`) inside the repo, so
 * the full Cowork playbook (recon → score → humble drafts → supervised/auto
 * sends, with the reply-stop + rate-limit guardrails) drives the always-on,
 * LinkedIn-logged-in Chrome on this machine.
 *
 * It does NOT contain prospecting logic itself — that lives in
 * prospecting/cowork-loop.md and is executed by Claude. This file is just the
 * claim → run → complete plumbing.
 *
 * Env (set in the launchd plist or a sourced env file):
 *   COWORK_RUNNER_TOKEN   bearer token (matches Vercel COWORK_RUNNER_TOKEN)   [required]
 *   COWORK_SITE_URL       default https://thinkbigjoe.com
 *   COWORK_REPO_DIR       path to the cloned repo (cwd for claude)            [required]
 *   COWORK_POLL_MS        idle poll interval, default 120000 (2 min)
 *   COWORK_AUTOSEND       "1" = full auto-send mode, "0" = draft-first        [default 1]
 *   CLAUDE_BIN            path to claude, default "claude"
 */
import { spawn } from "node:child_process";

const SITE = (process.env.COWORK_SITE_URL || "https://thinkbigjoe.com").replace(/\/$/, "");
const TOKEN = process.env.COWORK_RUNNER_TOKEN;
const REPO_DIR = process.env.COWORK_REPO_DIR;
const POLL_MS = Number(process.env.COWORK_POLL_MS || 120000);
const AUTOSEND = process.env.COWORK_AUTOSEND !== "0";
const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";

if (!TOKEN) {
  console.error("[cowork] COWORK_RUNNER_TOKEN is required");
  process.exit(1);
}
if (!REPO_DIR) {
  console.error("[cowork] COWORK_REPO_DIR is required");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), ...a);

async function claim() {
  const r = await fetch(`${SITE}/api/cowork/claim`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  if (!r.ok) {
    log("[cowork] claim failed:", r.status, await r.text().catch(() => ""));
    return null;
  }
  const { job } = await r.json();
  return job || null;
}

async function complete(id, status, resultSummary) {
  const r = await fetch(`${SITE}/api/cowork/complete`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ id, status, resultSummary }),
  });
  if (!r.ok) log("[cowork] complete failed:", r.status, await r.text().catch(() => ""));
}

function buildPrompt(job) {
  const target = job.target_count ? `${job.target_count}` : "a sensible batch (10–20)";
  const where = job.location ? ` in ${job.location}` : " (nationwide US)";
  const vert = job.vertical || "the highest-priority vertical";
  const mode = AUTOSEND
    ? "FULL AUTO-SEND is ON: you may send opening LinkedIn connection requests to newly-qualified prospects yourself, at human pace, within the hard cap of 20 connection requests per day (count outreach rows marked sent today across all jobs — never exceed 20). One opener per prospect."
    : "DRAFT-FIRST: do NOT send anything. Only create drafts for Joe to approve in /command.";

  return [
    `You are Cowork for ThinkBigJoe, running headless on the always-on Mac Mini.`,
    `Chrome on this machine is logged into Joe's LinkedIn + Sales Navigator — drive it with the Claude-in-Chrome browser tools.`,
    ``,
    `## Your job (cowork_jobs #${job.id})`,
    `Raw command: "${job.raw_command}"`,
    `Intent: ${job.intent}`,
    job.intent === "find_leads"
      ? `Find ${target} ${vert} leads${where}, EXPANDING the prospects DB (do not duplicate existing rows).`
      : `Work the existing qualified queue${job.vertical ? ` for ${vert}` : ""}.`,
    ``,
    `## How`,
    `1. If they exist in this repo, read prospecting/cowork-loop.md, prospecting/per-lead-routine.md, and prospecting/outreach-templates.md and follow them exactly (Joe syncs these privately; they hold the refined humble tone + message bank). If they're missing, follow the tone rules below: humble, grateful, curious, reply-first — never pushy or pitchy; no agenda in the opener.`,
    `2. Check the LinkedIn inbox for any new replies BEFORE sending anything. Any reply with a real question or a back-and-forth → STOP that thread, do not respond, and it will be surfaced to Joe.`,
    `3. ${job.intent === "find_leads" ? "Source matching owners/principals (Sales Nav recipe in the prospecting memo, or public web), run recon → fit score → draft a humble connection note, and INSERT new rows into the `prospects` + `outreach` tables (status draft) via the DATABASE_URL in .env.local. Skip anyone already in the DB." : "Send the approved/queued opening notes for qualified prospects."}`,
    `4. ${mode}`,
    `5. Guardrails (HARD): never faster than a person; randomized gaps; ≤20 connection requests/day; STOP immediately on any captcha / 2FA / verification / unexpected screen and report it; never bypass bot-detection.`,
    ``,
    `## When done`,
    `Print EXACTLY ONE final line starting with "SUMMARY: " — a single sentence of what happened (e.g. "SUMMARY: Added 12 insurance prospects in CA, sent 8 connection requests, 0 replies."). That line is reported back to Joe on Telegram.`,
  ].join("\n");
}

function runClaude(job) {
  return new Promise((resolve) => {
    const args = [
      "-p",
      buildPrompt(job),
      "--dangerously-skip-permissions",
    ];
    const child = spawn(CLAUDE_BIN, args, { cwd: REPO_DIR, env: process.env });
    let out = "";
    child.stdout.on("data", (d) => {
      out += d.toString();
      process.stdout.write(d);
    });
    child.stderr.on("data", (d) => process.stderr.write(d));
    child.on("close", (code) => {
      const line = (out.match(/SUMMARY:\s*(.+)$/im) || [])[1];
      const summary =
        (line && line.trim()) ||
        (code === 0 ? "Job completed (no summary line returned)." : `Runner exited ${code}.`);
      resolve({ ok: code === 0, summary });
    });
    child.on("error", (err) => resolve({ ok: false, summary: `Failed to launch claude: ${err.message}` }));
  });
}

async function main() {
  log(`[cowork] runner up. site=${SITE} autosend=${AUTOSEND ? "on" : "off"} poll=${POLL_MS}ms`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let job = null;
    try {
      job = await claim();
    } catch (err) {
      log("[cowork] claim error:", err.message);
    }
    if (!job) {
      await sleep(POLL_MS);
      continue;
    }
    log(`[cowork] claimed job #${job.id}: ${job.raw_command}`);
    try {
      const { ok, summary } = await runClaude(job);
      await complete(job.id, ok ? "done" : "failed", summary);
      log(`[cowork] job #${job.id} ${ok ? "done" : "failed"}: ${summary}`);
    } catch (err) {
      await complete(job.id, "failed", `Runner error: ${err.message}`);
      log(`[cowork] job #${job.id} crashed:`, err.message);
    }
    // brief breather between jobs
    await sleep(5000);
  }
}

main();
