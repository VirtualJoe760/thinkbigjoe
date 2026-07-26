-- Orgs link to an ACCOUNT: the org has a name, but its identity anchor is the owning account.
-- account_number mirrors better_auth."user".account_number for the owner (human-facing id like
-- 323342); owner_user_id stays the stable join key.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS account_number text;

UPDATE organizations o
SET account_number = u.account_number
FROM better_auth."user" u
WHERE u.id = o.owner_user_id AND o.account_number IS NULL;
