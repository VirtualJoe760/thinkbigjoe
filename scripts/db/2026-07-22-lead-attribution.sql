-- Paid-traffic attribution on inbound web leads — capture which ad brought the form-fill, so we
-- can compute cost-per-lead per campaign BEFORE spending real money on Meta (docs/ADS.md).
--
-- Captured client-side on landing (last paid touch, localStorage), submitted with the intake
-- form, stored here. All nullable — organic leads simply have none.
--
-- Rollback: alter table leads drop column utm_source, drop column utm_medium,
--   drop column utm_campaign, drop column utm_content, drop column utm_term,
--   drop column fbclid, drop column referrer, drop column landing_path;

alter table leads
  add column if not exists utm_source   text,   -- e.g. 'meta'
  add column if not exists utm_medium   text,   -- e.g. 'paid-social'
  add column if not exists utm_campaign text,   -- campaign slug, the cost-per-lead group key
  add column if not exists utm_content  text,   -- ad/creative variant
  add column if not exists utm_term     text,   -- adset/audience variant
  add column if not exists fbclid       text,   -- Meta click id (CAPI dedup later)
  add column if not exists referrer     text,   -- document.referrer at first paid touch
  add column if not exists landing_path text;   -- the path the click landed on

-- Cost-per-campaign reporting groups by campaign; only paid leads have one.
create index if not exists leads_utm_campaign_idx on leads(utm_campaign) where utm_campaign is not null;
