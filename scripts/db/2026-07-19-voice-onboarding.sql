-- Voice-led receptionist onboarding: Ivy interviews a paying customer over the phone instead of
-- making them fill in the /portal/receptionist form.
--
-- Spec + threat model: docs/VOICE_ONBOARDING.md
--
-- WHY THIS TABLE EXISTS AT ALL: account numbers are sequential from 100001 and /api/voice/verify
-- has no attempt cap, so an account number IDENTIFIES a caller but cannot AUTHORIZE one. Letting a
-- caller rewrite receptionist config after only reading a guessable number back would let an
-- attacker point another business's emergency calls at their own phone. This table holds the
-- second factor: a one-time code sent to a destination ALREADY ON FILE (never one the caller
-- supplies), plus the attempt counters that make guessing it impractical.
--
-- Rollback: drop table if exists voice_onboarding;

create table if not exists voice_onboarding (
  id            serial primary key,
  site_id       integer not null references forge_sites(id),
  user_id       text,                                  -- better_auth user, when the site is claimed

  -- The one-time code and where it actually went. `sent_to` is recorded so a support call can
  -- answer "which phone did you text?" without guessing, and so an auditor can confirm we never
  -- sent it somewhere the caller chose.
  code          text not null,
  sent_to       text not null,                         -- E.164 or an email address
  channel       text not null,                         -- 'sms' | 'email'

  status        text not null default 'pending',       -- pending | verified | expired | locked
  attempts      integer not null default 0,            -- wrong codes tried; lock at 5
  expires_at    timestamptz not null,
  verified_at   timestamptz,

  -- Retell's call id, so a dropped call can be distinguished from a fresh attempt and so the
  -- interview can resume without re-verifying.
  retell_call_id text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One live challenge per site. A second /start supersedes the first rather than racing it.
create unique index if not exists voice_onboarding_live_idx
  on voice_onboarding(site_id) where status = 'pending';

create index if not exists voice_onboarding_site_idx on voice_onboarding(site_id, created_at desc);
