# Documentation index

This is the reference index `AGENTS.md`/`CLAUDE.md` points to. Every doc here should be kept
current — if you change behavior that one of these describes, update the doc **in the same
change**, not as a follow-up. A doc that silently drifts from reality is worse than no doc: see
`FORGE.md`'s incident writeup and `VENUS_UI_MAPPING.md`'s own history for what happens when this
slips.

| Doc | Read this when… |
|---|---|
| [`AGENTS.md`](../AGENTS.md) *(repo root)* | Always — the entry point. The ecosystem map (which of the 3 codebases owns a given change), the full-stack shipping rule, and the standing cost-safety rule. |
| [`OPENCLAW.md`](OPENCLAW.md) | You're touching an agent's behavior/personality, adding or editing a cron, debugging why an agent "isn't doing anything," or need to know which model an agent should run on. |
| [`FORGE.md`](FORGE.md) | You're touching site-building: a template, the queue/poller, deploy behavior, or anything that could trigger a `claude -p` build. **Read before any bulk `forge_sites` status change.** Includes the architecture map + exact env-var wiring between this repo and the forge repo. |
| [`VENUS_UI_MAPPING.md`](VENUS_UI_MAPPING.md) | You're building or changing a `/command/**` or `/portal/**` surface, and need to know which MCP tool/cron/engine is supposed to feed it (or vice versa — a UI surface exists and you need to find its data source). |
| [`ACQUISITION_SYSTEM.md`](ACQUISITION_SYSTEM.md) | You need the original multi-agent client-acquisition gameplan for context. **Partly aspirational** — it says so at the top; treat anything not corroborated by the docs above as not-yet-built, not as current behavior. |

## Keeping this current

Docs rot the moment behavior changes and the doc doesn't. The rule (also stated in `AGENTS.md`):
**when a change makes something in one of these docs inaccurate, fix the doc in the same PR.**
Common triggers to watch for:
- Added/removed a `/command/**` or `/portal/**` route or nav tab → `VENUS_UI_MAPPING.md`.
- Added/edited/removed a Venus cron, an MCP tool, or the agent roster → `OPENCLAW.md` and/or
  `VENUS_UI_MAPPING.md`.
- Changed the forge's lifecycle, queue behavior, template library, or anything cost-related →
  `FORGE.md`.
- Added a new doc → add it to the table above.

If you're not sure a doc is still accurate, the fastest check is to grep the actual code/config
for the specific claim (file paths, env var names, table/column names) rather than trust the doc's
prose — the docs above call this out explicitly where it's mattered before.
