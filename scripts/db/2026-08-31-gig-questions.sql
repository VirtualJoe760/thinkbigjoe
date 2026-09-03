-- 2026-08-31 — let agent_questions belong to a GIG, not only a job application.
--
-- Destiny now submits proposals on Upwork herself, which means she can get stuck mid-submit on a
-- question only Joe can answer (an exact rate, hours/week, a Connect ceiling). agent_questions
-- already carried an `agent` column, but its only foreign key was application_id → job_applications
-- (Whitney's table). A Destiny question therefore had nowhere to point, and would have rendered on
-- Whitney's board as an unattributed "General question".
--
-- Additive and nullable: every existing row keeps working untouched. A question carries at most
-- one of application_id / gig_id, and neither is required — a general question still has both null.
ALTER TABLE agent_questions
  ADD COLUMN IF NOT EXISTS gig_id integer REFERENCES gigs(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS agent_questions_gig_idx ON agent_questions USING btree (gig_id);

-- Open questions are read per-agent on every board render, so make that the cheap path.
CREATE INDEX IF NOT EXISTS agent_questions_agent_status_idx
  ON agent_questions USING btree (agent, status, created_at DESC);
