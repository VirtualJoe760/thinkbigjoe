-- Where Whitney was when she got stuck.
--
-- She hard-stops on a CAPTCHA / ID wall / un-answerable field and posts a question. Until now the
-- question recorded WHAT she was blocked on but never WHERE — so the half-filled form lived only
-- in an open browser tab. Any tab close, browser restart or gateway restart lost it, and Joe had
-- no way back to the thing she needed help with. A URL in the database survives all of that.

ALTER TABLE agent_questions ADD COLUMN IF NOT EXISTS resume_url   text;
ALTER TABLE agent_questions ADD COLUMN IF NOT EXISTS resume_state text;

COMMENT ON COLUMN agent_questions.resume_url   IS 'Exact page Joe should reopen to finish this — the form she was on, not the job listing.';
COMMENT ON COLUMN agent_questions.resume_state IS 'What is already filled in and what is left, so Joe does not redo her work or wonder what is missing.';
