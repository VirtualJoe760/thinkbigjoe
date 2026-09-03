-- 2026-09-03 — the money desk (Max 💸 + Ryan 🔍) lands in the database.
--
-- Max and Ryan coordinate through a JSON file on Joe's Mac
-- (~/.openclaw/shared/max-ryan/desk.json, driven by desk.mjs). That file is deliberately the
-- source of truth for the AGENTS: the claim lock, the 3-round cap and the 7-day ASAP bar are all
-- enforced inside that script, which is what makes "they never work the same idea at once" a
-- guarantee rather than a hope.
--
-- But the Command Center runs on Vercel and CANNOT READ A FILE ON JOE'S MAC. Same wall the
-- dashboard agent-chat hit (see scripts/agent-bridge.mjs). So these tables are a MIRROR, not the
-- master: scripts/money-desk-sync.mjs pushes the file up on a launchd interval and /command/money
-- reads from here. Nothing in the app writes back — an edit here would be silently overwritten on
-- the next sync, and worse, would desync the claim lock the agents actually rely on.
--
-- Two shape decisions worth keeping:
--
-- 1. The thread is NORMALISED INTO ROWS, not stored as one jsonb blob. These two write long
--    messages (Ryan's first challenge was ~2KB), so a single snapshot column would grow without
--    bound and be re-read in full on every page load. Full-table reads behind a page are exactly
--    what ran the Neon egress quota down in July 2026. Rows + an index means the board loads the
--    last N and nothing else.
--
-- 2. Every row carries a `dedupe_key`, UNIQUE. The sync is a dumb re-read of the whole file every
--    few minutes, so it MUST be idempotent — without the key, each pass would re-insert the entire
--    conversation. The key is derived from immutable content (timestamp + author + body hash), not
--    from array position, because the desk's thread array is append-only but its indices shift
--    whenever a stale claim is auto-released.
--
-- `report_html` lives on the verdict row rather than in its own table: reports are 1:1 with a
-- `pursue`, and desk.mjs already records the file path on the conclusion. The column is large-ish
-- (~9KB), so the board's list view MUST NOT select it — only the single-report view does.

-- The desk's current state: one row, always id = 1.
CREATE TABLE IF NOT EXISTS money_desk_state (
  id               integer PRIMARY KEY DEFAULT 1,
  turn             text,                                   -- whose move it is: 'max' | 'ryan'
  claims           jsonb NOT NULL DEFAULT '{}'::jsonb,     -- { max: {topic, one_liner, rounds, claimed_at} | null, ryan: … }
  graveyard        jsonb NOT NULL DEFAULT '[]'::jsonb,     -- killed ideas + why, so neither re-digs them
  desk_updated_at  timestamptz,                            -- when the FILE last changed (not when we synced)
  synced_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT money_desk_state_single_row CHECK (id = 1)
);

-- The conversation itself — this is the "are they actually arguing?" record.
CREATE TABLE IF NOT EXISTS money_desk_messages (
  id          serial PRIMARY KEY,
  at          timestamptz NOT NULL,
  from_agent  text NOT NULL,                               -- 'max' | 'ryan' | 'desk' (system notes)
  to_agent    text NOT NULL,
  kind        text NOT NULL,                               -- claim | question | challenge | advice | answer | verdict | system
  body        text NOT NULL,
  dedupe_key  text NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS money_desk_messages_at_idx ON money_desk_messages (at DESC);

-- Converged verdicts. `dissent` is the point of the whole desk: it is the OTHER agent's unresolved
-- objection, carried forward and never deleted, so the board shows Joe the argument instead of a
-- laundered agreement. A verdict with an empty dissent is the one to distrust, not the one to trust.
CREATE TABLE IF NOT EXISTS money_desk_verdicts (
  id                         serial PRIMARY KEY,
  topic                      text NOT NULL,
  owner                      text NOT NULL,                -- which agent concluded it
  verdict                    text NOT NULL,                -- pursue | park | kill
  what_to_do                 text,
  how                        jsonb,                        -- ordered steps
  practicality               integer,                      -- 1-5
  time_to_first_dollar_days  integer,                      -- THE ranking axis; > 7 needs an override
  cost_to_start_usd          numeric,
  who_pays                   text,                         -- no nameable payer = not an idea
  evidence                   jsonb,                        -- [{claim, url, tier, date}] — tier: verified|reported|anecdotal
  dissent                    text,
  override_reason            text,                         -- set only when a slower-than-7-day play was still pursued
  decided_at                 timestamptz NOT NULL,
  reported_to_venus          boolean NOT NULL DEFAULT false,
  report_path                text,
  report_html                text,                         -- ⚠️ never SELECT this in a list query
  dedupe_key                 text NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS money_desk_verdicts_decided_idx ON money_desk_verdicts (decided_at DESC);

-- 2026-09-03 (later the same day) — retraction.
--
-- Joe said the home-services niche was wrong, which quietly invalidated a live `pursue` verdict
-- telling him to go call home-services owners. A stale green verdict is worse than no verdict: it
-- is a confident instruction resting on something nobody believes any more, and the board renders
-- it identically to a good one. So a conclusion can now be WITHDRAWN with a reason, rather than
-- deleted — the history of what they thought, and why it stopped being true, is the useful part.
ALTER TABLE money_desk_verdicts
  ADD COLUMN IF NOT EXISTS retracted     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS retracted_why text;
