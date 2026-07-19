# Agent Platform — the plugin system behind the tiers

> **Status**: SPEC — not built yet. This is the build plan.
> **Written**: 2026-07-18 · **Owner**: Joseph Sardella
> **Why this exists**: [`BUSINESS_PLAN.md`](./BUSINESS_PLAN.md) sells a tiered agent menu where
> revenue grows by turning agents on for existing accounts. That requires agents to be
> **installable after the sale**. Today they aren't — plans are hardcoded bundles.

---

## The idea in one paragraph

A customer buys a **tier**. A tier grants **entitlements** to a set of **agents**. Each agent is a
self-contained unit with an install hook, an uninstall hook, its own config, and its own panel in
the portal. Turning an agent on is a provisioning event, not a code change. The portal shows every
agent — including the ones above their tier, switched off — because seeing them is what sells the
upgrade.

**Naming warning:** the existing `agents` table is the **OpenClaw org** (Venus, prospector,
outreach). Customer-facing agents are `site_agents`. Do not conflate them.

---

## Core model

### Three concepts

| Concept | What it is | Lives in |
|---|---|---|
| **Agent** | An installable capability (voice, text, estimate follow-up…) | `src/lib/agents.ts` registry |
| **Tier** | What the customer pays for; grants entitlements | `src/lib/plans.ts` (rewritten) |
| **Installation** | One agent, enabled for one account, with config + status | `site_agents` table |

### The registry

```ts
// src/lib/agents.ts — single source of truth for what can be installed
export type AgentKey =
  | "voice" | "text" | "estimates" | "seasonal" | "reactivation" | "reviews";

export interface AgentDef {
  label: string;
  blurb: string;                       // portal copy
  minTier: TierKey;                    // entitlement floor
  requires?: AgentKey[];               // dependencies
  needsCustomerData: boolean;          // gated on the ingress layer (see below)
  provision(siteId: string, cfg: unknown): Promise<void>;
  deprovision(siteId: string): Promise<void>;
  health(siteId: string): Promise<AgentHealth>;
}
```

Adding an agent = adding one entry here plus its provision/deprovision implementation. Nothing else
in the app should know the list of agents.

### Schema — new table, not more columns

```sql
create table site_agents (
  id            uuid primary key,
  site_id       uuid not null references forge_sites(id),
  agent_key     text not null,
  status        text not null default 'off',   -- off|provisioning|active|paused|error
  config        jsonb not null default '{}',
  enabled_at    timestamptz,
  last_run_at   timestamptz,
  last_error    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (site_id, agent_key)
);
```

**`forge_sites` is already 98 columns. Nothing about agents goes on it.** This table is also the
first demand-driven decomposition of that god table — the refactor gets started by revenue work
rather than on spec. DB first, then `npm run db:pull`; never hand-edit `src/db/schema.ts`.

Existing `receptionist_config` / `receptionist_status` columns migrate into the `voice` row's
`config` / `status` and are then left in place until the senders that read them are cut over
(same staged pattern as the contact columns in [`CONTACTS.md`](./CONTACTS.md)).

---

## Lifecycle

| Event | What happens |
|---|---|
| **Sale** | Stripe webhook sets tier → `syncEntitlements(siteId)` → newly allowed agents become **available**, not auto-on. |
| **Customer turns one on** | `installAgent(siteId, key)` → status `provisioning` → run `provision()` → `active`, or `error` with `last_error`. |
| **Upgrade** | Same as sale. More agents become available. |
| **Downgrade** | Agents above the new tier go to **`paused`, never deleted.** Config and history survive. Coming back is one click. |
| **Cancel** | All agents `paused`. Data retained per policy. |
| **Provision failure** | `error` + surfaced in `/command` — never silently dead. |

**Provisioning must be idempotent.** Re-running `provision()` on an active agent is a no-op that
reconciles state. This is what makes retries and recovery safe.

---

## The agent catalog

| Agent | Tier | Install does | Needs customer data? |
|---|---|---|---|
| **voice** | 1 Answer | Create/update Retell agent, assign or forward number, write config | No |
| **text** | 2 Respond | Provision Twilio number, bind to `/api/sms/inbound`, map conversation | No |
| **estimates** | 2 Respond | Watch for unsold quotes, run follow-up sequence | **Yes** |
| **seasonal** | 3 Recover | Schedule spring/fall campaigns against customer list | **Yes** |
| **reactivation** | 3 Recover | Segment dormant customers, run win-back | **Yes** |
| **reviews** | 3 Recover | Trigger on job completion, request review | **Yes** |

### The dependency that determines build order

**Voice and text are self-contained** — they ride on the phone line and need nothing from the
customer's systems. Everything in tier 3 and half of tier 2 needs the customer's **job and customer
data**, which we have no way to get today.

**That ingress layer is the real unlock, and it is not built.** Do not discover this in week four.

Ingress options, in build order:
1. **CSV import** — fastest, works for every customer, good enough for seasonal + reactivation.
2. **Email forwarding** — they forward quote/invoice emails to a per-account address; we parse.
   Unlocks `estimates` without an integration.
3. **CRM sync** — Jobber, Housecall Pro, ServiceTitan all have APIs. Highest fidelity, most work,
   and only worth it once several customers share a CRM.

---

## Pricing migration

`src/lib/plans.ts` is rewritten from three bundles to three tiers.

| Old | New |
|---|---|
| `website` $99 / `voice` $299 / `complete` $999 | `answer` $497 / `respond` $797 / `recover` $1,197 |
| $300 one-time build fee | **$250 setup** |
| Website is a paid tier | **Website is included in every tier** — a delivery component, not a product |

New Stripe products and price IDs via `scripts/stripe/setup-products.mjs`. Keep `planKeyForPrice()`
working for legacy price IDs so any existing subscription still resolves.

`PLANS[].features` (a flat string array) is replaced by `TIERS[].agents: AgentKey[]` — the portal
renders features *from the agent registry* so copy and entitlements can never drift apart.

---

## Build order

Every phase ships **UI + MCP tool + schedule** together, per [`AGENTS.md`](../AGENTS.md).

### Phase A — The platform (week 1–2)
The framework, with voice retrofitted onto it. Nothing customer-visible changes yet.
- `site_agents` table · `src/lib/agents.ts` registry · `installAgent` / `uninstallAgent` /
  `syncEntitlements`
- Retrofit **voice** as the first registry agent; migrate `receptionist_config`
- **UI**: `/portal/agents` — enabled, available, and locked-above-tier
- **MCP**: `list_site_agents`, `install_site_agent`, `uninstall_site_agent`
- **Cron**: hourly `agent-health` reconcile → flags `error` rows to `/command`

### Phase B — Sell tier 1 (week 1–3, parallel)
The prospecting side. Independent of Phase A — do not let them block each other.
- Twilio **Lookup** filter (drop mobile numbers) + AMD call test + status-callback handler
- `call_test_result` / `call_test_at` on the prospect row
- **UI**: disposition column on `/command/prospects`
- **MCP**: `run_call_test`, `get_call_test_result`
- **Cron**: after-hours + Sunday-AM test runner, rate-limited, separate number pool from the
  closing number
- **Gate**: manual dialing until a telecom attorney signs off on automated testing

### Phase C — Tier 2, self-contained half (week 3–5)
- **text** agent on the registry, reusing the existing Twilio relay
- Per-account number provisioning
- Portal: conversation view

### Phase D — Data ingress (week 5–8) — *the unlock*
- CSV customer/job import + a normalized `customer_records` table
- Per-account forwarding address + quote/invoice parsing
- Portal: import UI + record browser

### Phase E — Tier 2/3 agents (week 8+)
- **estimates** (needs D) → then **seasonal**, **reactivation**, **reviews**
- Each is a registry entry + a cron + a portal panel. **No new framework work by this point.**

### Phase F — The ROI rollup
- Monthly per-account summary: calls answered, jobs booked, estimates recovered, revenue attributed
- Emailed + shown in the portal

**Ship F early if a customer asks about value.** Only 18% of businesses track AI ROI at all —
handing them the number is the retention mechanism, and it's cheap to build.

---

## What's already built

| Piece | State |
|---|---|
| Retell voice agent + `/api/voice/*` webhooks | **Built** — see [`VOICE.md`](./VOICE.md) |
| `/portal/receptionist` config surface | **Built** — becomes the `voice` agent panel |
| Twilio SMS relay + `/api/sms/inbound` | **Built** — see [`SMS.md`](./SMS.md) |
| Stripe checkout + subscription webhook | **Built** — needs new price IDs |
| Site forge (website delivery) | **Built** — now a delivery component, not a product |
| `site_agents`, registry, install/uninstall | **Not built** |
| Call test (Lookup + AMD) | **Not built** |
| Customer data ingress | **Not built** — blocks tiers 2–3 |

---

## Risks

| Risk | Response |
|---|---|
| **Tier 2/3 sold before built** | Sell tier 1 only until the agent exists. Never promise a date. |
| **Ingress layer underestimated** | It's Phase D for a reason. If it slips, tiers 2–3 slip with it — say so rather than shipping a stub. |
| **Per-client customization creeps in** | The registry is the contract. Off-menu requests ship to everyone or nobody. |
| **Provisioning half-fails silently** | Idempotent hooks + hourly reconcile + `error` surfaced in `/command`. |
| **Caller-ID reputation burn** | Separate number pool for call tests vs. selling. |
| **TCPA exposure on automated dialing** | Lookup filter, after-hours only, logged dispositions, legal review before scaling. |

---

## Docs to update when these land

[`VOICE.md`](./VOICE.md) (voice becomes a registry agent) · [`SMS.md`](./SMS.md) (per-account
provisioning) · [`VENUS_UI_MAPPING.md`](./VENUS_UI_MAPPING.md) (new crons/tools/surfaces) ·
[`PLATFORM.md`](./PLATFORM.md) (this is the demand-driven start of the `forge_sites` decomposition
that Phase 2 wanted) · [`README.md`](./README.md) index.
