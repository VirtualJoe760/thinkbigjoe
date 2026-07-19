-- Voice multi-tenancy: routing + call history.
-- Spec: docs/VOICE_TENANCY_SPEC.md (stage 1)
--
-- Purely additive: two new tables, no changes to anything existing.
-- Conventions matched from the rest of the schema: serial integer PKs (30 of 32 tables),
-- timestamptz with now() defaults, text columns.
--
-- Nothing goes on forge_sites — it is already 98 columns.
-- Apply, then `npm run db:pull` to regenerate src/db/schema.ts.
--
-- Rollback:  drop table if exists calls; drop table if exists voice_lines;

-- Which business owns which phone number. PK-indexed lookup on every inbound call —
-- this is how a single shared Retell agent serves every customer.
create table if not exists voice_lines (
  id               serial primary key,
  phone_number     text not null unique,                    -- E.164, the number we provisioned
  site_id          integer not null references forge_sites(id),
  status           text not null default 'provisioning',    -- provisioning|active|paused|released
  retell_agent_id  text,                                    -- null = the shared receptionist agent
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists voice_lines_site_idx on voice_lines(site_id);

-- Call history. This is what /portal/calls renders and what makes the product visible
-- on day 2. Retell's retention is not our database — if we don't write it here, it's gone.
create table if not exists calls (
  id               serial primary key,
  site_id          integer not null references forge_sites(id),
  retell_call_id   text unique,                             -- idempotency key for the webhook
  from_number      text,
  to_number        text,
  started_at       timestamptz,
  ended_at         timestamptz,
  duration_sec     integer,

  -- captured live by the take_message tool
  caller_name      text,
  callback_number  text,
  address          text,
  problem          text,
  urgency          text,                                    -- emergency|urgent|routine
  is_real_lead     boolean,

  -- filled in after the call by Retell's call_analyzed webhook
  summary          text,
  transcript       text,
  disposition      text,                                    -- message|booked|transferred|spam|unknown
  recording_url    text,

  notified_at      timestamptz,                             -- when the owner was actually texted
  created_at       timestamptz not null default now()
);

create index if not exists calls_site_started_idx on calls(site_id, started_at desc);
