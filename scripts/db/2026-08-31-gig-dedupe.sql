-- 2026-08-31 — make "never bid on the same posting twice" enforceable, not hopeful.
--
-- Destiny submits proposals herself now, so a duplicate is no longer a cosmetic double-row on a
-- board: it is a second 14-25 Connect bid (~$2-4) on a job Joe already pitched, and to the client
-- it reads as spam from someone who does not track their own work.
--
-- The existing guard was `gigs_url_uniq` — a UNIQUE index on the raw url. It missed two things:
--   1. Upwork URLs decorate freely. The same posting arrives as
--        /jobs/~021234abcd
--        /jobs/~021234abcd?source=link_search  (and /freelance-jobs/apply/... variants)
--      Three different strings, three rows, three bids, one job.
--   2. `url` was never required, and the index is partial (WHERE url IS NOT NULL), so any two
--      rows with a NULL url deduped against nothing at all.
--
-- url_key is the STABLE identity: Upwork's own ~0-prefixed job ciphertext when we can find it,
-- otherwise the url stripped of query/fragment/trailing slash. Unique, so the database refuses a
-- second row for one posting no matter how the link was decorated.
ALTER TABLE gigs ADD COLUMN IF NOT EXISTS url_key text;

-- Backfill existing rows with the same rule the MCP server applies going forward:
-- prefer the ~0 job id, else the url minus query string, fragment and trailing slash.
UPDATE gigs
   SET url_key = COALESCE(
         (regexp_match(url, '(~[0-9a-zA-Z]{10,})'))[1],
         NULLIF(regexp_replace(split_part(split_part(url, '#', 1), '?', 1), '/+$', ''), '')
       )
 WHERE url IS NOT NULL AND url_key IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS gigs_url_key_uniq
  ON gigs USING btree (url_key) WHERE (url_key IS NOT NULL);

-- Catching a RE-POST: the same client listing the same work under a brand new job id is a
-- legitimately different posting, so it must not be blocked outright — but Destiny should see it
-- and decide, rather than bid twice by accident. This index makes that lookup cheap.
CREATE INDEX IF NOT EXISTS gigs_client_title_idx
  ON gigs USING btree (lower(client), lower(title));
