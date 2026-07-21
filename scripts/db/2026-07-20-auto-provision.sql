-- Auto-provision pipeline: payment → voice line live, guarded.
-- Spec: docs/AUTOMATION_PIPELINE.md (Phase 2 keystone) · guardrail mirrors forge_engine.
--
-- Purely additive: two new tables, no changes to anything existing. Deliberately NOTHING on
-- forge_sites (already 98 columns) — the build queue already IS forge_sites.status='approved',
-- and the voice queue gets its own small table below.
--
-- Conventions matched from the rest of the schema: serial integer PKs, timestamptz with now()
-- defaults, text columns, single-row config table keyed id=1 (mirrors forge_engine).
--
-- Apply, then `npm run db:pull` to regenerate src/db/schema.ts.
--
-- Rollback:  drop table if exists voice_provision_queue; drop table if exists auto_provision;

-- ── The switch + cap + warn-bands. Single global row (id=1), exactly like forge_engine. ──────────
-- Default OFF is load-bearing: flipping `enabled` on is the deliberate act that turns "money spend
-- manual" into "money spend automatic". The cap is what bounds a runaway. See AUTOMATION_PIPELINE.md.
create table if not exists auto_provision (
  id                  serial primary key,
  enabled             boolean not null default false,   -- master: auto-provision voice on payment (money-spend). OFF = manual.
  weekly_line_budget  integer not null default 10,      -- cap: phone numbers bought per rolling 7 days. Drainer pauses at the cap, never drops the queue.
  auto_build_enabled  boolean not null default false,   -- opt-in: also auto-approve the site build on payment (forge_engine still gates the actual build spend).
  last_warn_pct       integer not null default 0,       -- warn-band de-dupe (75/90/100%), reset to 0 when the cap changes. Mirror of forge_engine.last_warn_pct.
  last_warn_week      text,                              -- ISO week the last warning fired for, so a new week re-arms.
  updated_at          timestamptz not null default now()
);
-- Seed the single row. id=1 is what every read/write hardcodes, matching forge_engine.
insert into auto_provision (id) values (1) on conflict (id) do nothing;

-- ── The voice-provision queue. One row per site awaiting a line. ─────────────────────────────────
-- The Stripe webhook writes here on a voice-plan payment (switch-AGNOSTIC — the enqueue never checks
-- the switch, so pausing/over-cap can never drop the customer). The drainer (scripts/provision-drain.mjs,
-- launchd, off unless auto_provision.enabled) reads the switch + cap and provisions or no-ops.
--
-- `unique(site_id)` is the idempotency interlock: Stripe retries checkout.session.completed with no
-- event dedup, so the enqueue is `insert ... on conflict (site_id) do nothing` — a retry can't
-- double-queue, and a site already provisioned won't be re-queued (guarded in the webhook).
create table if not exists voice_provision_queue (
  id          serial primary key,
  site_id     integer not null unique references forge_sites(id),
  status      text not null default 'queued',   -- queued | done | failed  (config-incomplete stays 'queued' and the drainer retries)
  queued_at   timestamptz not null default now(),
  attempts    integer not null default 0,        -- drainer attempts; a config-incomplete site accrues these until setup completes
  last_error  text,                              -- 'config incomplete' (retry later) or a real failure message (needs a human)
  updated_at  timestamptz not null default now()
);
create index if not exists voice_provision_queue_status_idx on voice_provision_queue (status);
