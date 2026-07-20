-- Owner feedback on individual calls — the loop that lets a customer tell us the AI got a call
-- wrong, and lets us improve the agent from real signal instead of guessing.
--
-- Spec: the voice agent feedback dashboard (/portal/dashboard). One row per call already exists;
-- feedback is 1:1 with a call, so it's columns on `calls` rather than a separate table.
--
-- Rollback: alter table calls drop column owner_rating, drop column owner_note, drop column owner_rated_at;

alter table calls
  add column if not exists owner_rating   text,          -- 'good' | 'bad' | null (not yet rated)
  add column if not exists owner_note      text,          -- optional free text when they flag one
  add column if not exists owner_rated_at  timestamptz;   -- when they rated it

-- Joe's "what did customers flag" view reads WHERE owner_rating = 'bad'; index the ones that exist.
create index if not exists calls_owner_rating_idx on calls(owner_rating) where owner_rating is not null;
