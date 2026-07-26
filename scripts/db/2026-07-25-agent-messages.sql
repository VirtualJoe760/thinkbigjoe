-- Chat between the dashboard and OpenClaw agents. The web UI can't reach the gateway
-- (127.0.0.1:18789 on the Mac), so messages queue here; scripts/agent-bridge.mjs (launchd, on the
-- Mac) delivers queued rows via `openclaw agent` and writes the reply back. Additive only.
CREATE TABLE IF NOT EXISTS agent_messages (
  id         serial PRIMARY KEY,
  agent_id   varchar(40) NOT NULL,
  direction  text NOT NULL CHECK (direction IN ('to_agent', 'from_agent')),
  body       text NOT NULL,
  status     text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'answered', 'failed', 'received')),
  reply_to   integer REFERENCES agent_messages(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_messages_agent_idx ON agent_messages (agent_id, created_at);
CREATE INDEX IF NOT EXISTS agent_messages_status_idx ON agent_messages (status) WHERE status = 'queued';
