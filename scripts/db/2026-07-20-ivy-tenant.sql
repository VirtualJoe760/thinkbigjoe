-- Make TBJ's own sales line (Ivy) a voice tenant so her calls PERSIST.
-- Spec: docs/PORTAL_REDESIGN.md Phase 4 (persistence half) · docs/VOICE_TENANCY_SPEC.md.
--
-- Today /api/voice/webhook DROPS Ivy's call_started/ended/analyzed events (route.ts:154) because her
-- number (+14807642121) has no voice_lines row → tenantByNumber returns null. This one row fixes that:
-- her calls now persist to `calls` under the internal TBJ site (is_internal=true), durably, beyond
-- Retell's ~limited retention. The admin Ivy log keeps working (it reads Retell live); this adds the
-- durable DB copy. Customer surfaces (dashboard/calls/usage) exclude is_internal so Ivy's SALES calls
-- never show as a customer receptionist.
--
-- SAFE for the live line: Ivy's agent prompt uses ZERO {{dynamic_variables}} (verified), so even if
-- her number is wired to /api/voice/inbound, the receptionist variables this row would surface are
-- inert — her static claim-concierge flow is unchanged. (The sales-variable branch — goal b — is a
-- separate, larger change and stays deferred; see docs/AUTOMATION_PIPELINE.md.)
--
-- Idempotent + cross-site safe: the `where voice_lines.site_id = excluded.site_id` on the upsert
-- refuses to re-point +14807642121 at a different site — the same interlock provision-line.mjs uses.
-- The internal site id is LOOKED UP (is_internal=true), never hardcoded.
--
-- Rollback:  delete from voice_lines where phone_number = '+14807642121';

insert into voice_lines (phone_number, site_id, status, retell_agent_id)
select '+14807642121', f.id, 'active', 'agent_fc091c7bd9f23c9760ed6fa559'
  from forge_sites f
  where f.is_internal = true
  order by f.id
  limit 1
on conflict (phone_number) do update
  set status = 'active',
      retell_agent_id = excluded.retell_agent_id,
      updated_at = now()
  where voice_lines.site_id = excluded.site_id;
