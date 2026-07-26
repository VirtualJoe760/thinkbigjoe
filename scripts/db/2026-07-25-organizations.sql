-- Organizations layer: every agent (and every site) belongs to an org — the company it works for.
-- TBJ is org #1; future customer orgs (e.g. a roofing company buying its own agents) slot in
-- without rework. Additive only. After applying: npm run db:pull, then
-- node scripts/sync-openclaw-agents.mjs to mirror the live OpenClaw roster into `agents`.

CREATE TABLE IF NOT EXISTS organizations (
  id            serial PRIMARY KEY,
  name          text NOT NULL,
  slug          text NOT NULL UNIQUE,
  owner_user_id text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE agents      ADD COLUMN IF NOT EXISTS org_id    integer REFERENCES organizations(id);
ALTER TABLE agents      ADD COLUMN IF NOT EXISTS model     text;
ALTER TABLE agents      ADD COLUMN IF NOT EXISTS workspace text;
-- Rows no longer present in the live OpenClaw roster are archived by the sync, never deleted —
-- their activity history stays joinable.
ALTER TABLE agents      ADD COLUMN IF NOT EXISTS archived  boolean NOT NULL DEFAULT false;
ALTER TABLE forge_sites ADD COLUMN IF NOT EXISTS org_id    integer REFERENCES organizations(id);

INSERT INTO organizations (name, slug, owner_user_id)
VALUES ('ThinkBigJoe', 'thinkbigjoe', 'vuv04C4Zgnmc7wQ9845xdskDfDMjcc2M')
ON CONFLICT (slug) DO NOTHING;

-- Everything that exists today works for TBJ.
UPDATE agents SET org_id = (SELECT id FROM organizations WHERE slug = 'thinkbigjoe') WHERE org_id IS NULL;
UPDATE forge_sites SET org_id = (SELECT id FROM organizations WHERE slug = 'thinkbigjoe')
WHERE is_internal = true AND org_id IS NULL;
