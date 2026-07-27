-- Bad-number handling for the dialer: a wrong/disconnected number is flagged, pulled from the
-- dial queue, and picked up by contact enrichment; when a NEW number lands, the flag clears and
-- the lead flows back into the queue automatically.
ALTER TABLE forge_sites ADD COLUMN IF NOT EXISTS phone_bad_at timestamptz;
ALTER TABLE forge_sites ADD COLUMN IF NOT EXISTS phone_bad_note text;
