-- 2026-09-02 — the investor pipeline (Vera → Edward → Venus → Joe).
--
-- Vera (agent id `angel-scout`) researches angel investors for ChatRealty and Edward drafts the
-- outreach from her bios. Before this table there was nowhere for that research to land: no
-- investor table, no investor MCP tool. An agent with nowhere to write is an agent whose work
-- evaporates between runs — and worse, one that re-researches the same people forever.
--
-- Two design decisions carry the weight here:
--
-- 1. `sources` is NOT NULL and the MCP tool rejects an empty array. The documented way an LLM fails
--    at investor research is fabricating plausible funds, partners and email addresses — worst on
--    the recent activity that matters most. A schema that permits an unsourced row is a schema that
--    will eventually hold one, and Edward will write a confident email on top of it. So the source
--    list is structural, not a convention.
--
-- 2. `dedupe_key` is unique per org. Whitney's re-application bug (she compared job TITLES, which
--    collide constantly, instead of URLs) cost a real duplicate submission. Same failure shape
--    applies here and costs more: emailing an investor twice is a first impression you only get to
--    ruin once. The key is the LinkedIn URL when we have one — a stable identifier — falling back to
--    name+firm only when we don't.
--
-- ChatRealty is its own organization, NOT ThinkBigJoe. The org row is created below if absent.

INSERT INTO organizations (name, slug)
VALUES ('ChatRealty', 'chatrealty')
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS investors (
  id                  serial PRIMARY KEY,
  org_id              integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- identity
  name                text NOT NULL,
  firm                text,
  role                text,
  location            text,
  linkedin_url        text,
  x_url               text,
  website_url         text,

  -- contact: only ever what was READ on a citable page, never constructed
  email               text,
  email_source        text,

  -- qualification
  tier                varchar(2),
  check_min           integer,
  check_max           integer,
  thesis              text,
  why_fit             text,
  last_check_at       date,
  last_check_evidence text,
  warm_path           text,
  conflicts           text,

  -- provenance: [{url, supports, checked_at}]
  sources             jsonb NOT NULL DEFAULT '[]'::jsonb,

  status              varchar(24) NOT NULL DEFAULT 'qualified',
  disqualified_reason text,
  notes               text,

  dedupe_key          text NOT NULL,
  created_by          varchar(40),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- status: qualified | drafting | awaiting_approval | contacted | replied | passed | disqualified
ALTER TABLE investors DROP CONSTRAINT IF EXISTS investors_status_check;
ALTER TABLE investors ADD CONSTRAINT investors_status_check CHECK (status IN
  ('qualified','drafting','awaiting_approval','contacted','replied','passed','disqualified'));

ALTER TABLE investors DROP CONSTRAINT IF EXISTS investors_tier_check;
ALTER TABLE investors ADD CONSTRAINT investors_tier_check CHECK (tier IS NULL OR tier IN ('T1','T2','T3'));

-- One row per human per org. This is the constraint that stops the double-email.
CREATE UNIQUE INDEX IF NOT EXISTS investors_org_dedupe_idx ON investors (org_id, dedupe_key);

-- Edward's read: qualified, tier-ranked, not yet contacted. Keep it off a seq scan.
CREATE INDEX IF NOT EXISTS investors_org_status_tier_idx
  ON investors (org_id, status, tier, updated_at DESC);
