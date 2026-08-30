-- Destiny's board: Upwork gigs, scored and pending Joe's approval.
--
-- Deliberately NOT reusing job_applications: that table is Whitney's job hunt (Joe as an
-- employee). A gig is a contract Joe sells, scored on a different axis — winnability with an
-- empty profile matters more than fit — and it carries a drafted proposal. Sharing one table
-- would mean two agents fighting over one board and one status vocabulary.

CREATE TABLE IF NOT EXISTS gigs (
  id                  serial PRIMARY KEY,
  title               text NOT NULL,
  client              text,
  url                 text,
  platform            varchar(24) NOT NULL DEFAULT 'upwork',
  -- which offer this gig belongs to, so a second lane (e.g. forge-fulfilled web design) is a
  -- config change rather than a new table.
  lane                varchar(24) NOT NULL DEFAULT 'ai-agent',

  budget              text,
  scope               text,
  description         text,

  -- signals that decide whether a no-review profile can realistically win it
  proposals_so_far    integer,
  client_hires        integer,
  client_verified     boolean,

  fit_score           integer,   -- can Joe do this well?
  win_score           integer,   -- can an empty profile WIN it? the number that matters most
  fit_reason          text,
  win_reason          text,

  proposal            text,      -- Destiny drafts; Joe sends. Never auto-submitted.
  proposal_drafted_at timestamptz,

  -- found → approved/dismissed → drafted → submitted → won/lost
  status              varchar(24) NOT NULL DEFAULT 'found',
  notes               text,

  posted_at           timestamptz,
  approved_at         timestamptz,
  submitted_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gigs_status_idx      ON gigs (status, created_at DESC);
CREATE INDEX IF NOT EXISTS gigs_win_idx         ON gigs (win_score DESC NULLS LAST, fit_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS gigs_created_at_idx  ON gigs (created_at DESC);
-- the same Upwork posting can arrive in several saved-search alerts; dedupe on the posting url
CREATE UNIQUE INDEX IF NOT EXISTS gigs_url_uniq ON gigs (url) WHERE url IS NOT NULL;
