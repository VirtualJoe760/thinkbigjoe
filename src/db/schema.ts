import { pgTable, serial, boolean, varchar, integer, date, timestamp, index, foreignKey, text, jsonb, check, numeric, uniqueIndex, unique, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const enumLeadsEmailType = pgEnum("enum_leads_email_type", ['business', 'free'])
export const enumLeadsSource = pgEnum("enum_leads_source", ['industry-page', 'booking-page', 'contact-form'])
export const enumLeadsStatus = pgEnum("enum_leads_status", ['new', 'booked', 'contacted', 'qualified', 'won', 'lost'])
export const enumLeadsTeamSize = pgEnum("enum_leads_team_size", ['1', '2-10', '11-50', '51-200', '200+'])
export const enumLeadsTimeline = pgEnum("enum_leads_timeline", ['asap', 'quarter', 'year', 'exploring'])
export const enumOutreachStatus = pgEnum("enum_outreach_status", ['draft', 'approved', 'edited', 'denied', 'sent'])
export const enumOutreachStep = pgEnum("enum_outreach_step", ['connection', 'diagnostic', 'reflect', 'invite', 'followup'])
export const enumPagesStatus = pgEnum("enum_pages_status", ['draft', 'published'])
export const enumProspectsLifecycle = pgEnum("enum_prospects_lifecycle", ['prospect', 'lead', 'client', 'past_client'])
export const enumProspectsStatus = pgEnum("enum_prospects_status", ['new', 'qualified', 'note_ready', 'connected', 'diagnostic_sent', 'replied', 'invited', 'prepped', 'meeting', 'won', 'lost', 'disqualified'])
export const enumProspectsTemperature = pgEnum("enum_prospects_temperature", ['cold', 'warm', 'hot'])
export const enumProspectsVertical = pgEnum("enum_prospects_vertical", ['insurance', 'mortgage', 'wealth', 'msp', 'law', 'other'])
export const forgeSiteStatus = pgEnum("forge_site_status", ['discovered', 'approved', 'denied', 'building', 'built', 'build_failed'])


export const automationSettings = pgTable("automation_settings", {
	id: serial().primaryKey().notNull(),
	enabled: boolean().default(false).notNull(),
	timezone: varchar().default('America/Los_Angeles').notNull(),
	workDays: varchar("work_days").default('Mon,Tue,Wed,Thu,Fri').notNull(),
	workStartHour: integer("work_start_hour").default(9).notNull(),
	workEndHour: integer("work_end_hour").default(17).notNull(),
	dailyGoal: integer("daily_goal").default(30).notNull(),
	rampEnabled: boolean("ramp_enabled").default(true).notNull(),
	rampStart: integer("ramp_start").default(10).notNull(),
	rampWeeklyStep: integer("ramp_weekly_step").default(5).notNull(),
	rampStartedOn: date("ramp_started_on"),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const outreach = pgTable("outreach", {
	id: serial().primaryKey().notNull(),
	prospectId: integer("prospect_id").notNull(),
	step: enumOutreachStep().default('connection').notNull(),
	body: varchar().notNull(),
	status: enumOutreachStatus().default('draft'),
	denyReason: varchar("deny_reason"),
	approvedAt: timestamp("approved_at", { precision: 3, withTimezone: true, mode: 'string' }),
	sentAt: timestamp("sent_at", { precision: 3, withTimezone: true, mode: 'string' }),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("outreach_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("outreach_prospect_idx").using("btree", table.prospectId.asc().nullsLast().op("int4_ops")),
	index("outreach_updated_at_idx").using("btree", table.updatedAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.prospectId],
			foreignColumns: [prospects.id],
			name: "outreach_prospect_id_prospects_id_fk"
		}).onDelete("set null"),
]);

export const replyDrafts = pgTable("reply_drafts", {
	id: serial().primaryKey().notNull(),
	prospectId: integer("prospect_id"),
	prospectName: varchar("prospect_name"),
	theirMessage: varchar("their_message"),
	draft: varchar(),
	finalText: varchar("final_text"),
	status: varchar().default('awaiting').notNull(),
	source: varchar().default('sentinel').notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("reply_drafts_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
]);

export const activityLog = pgTable("activity_log", {
	id: serial().primaryKey().notNull(),
	actor: varchar().default('venus').notNull(),
	eventType: varchar("event_type").notNull(),
	summary: text().notNull(),
	metadata: jsonb(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("activity_log_created_at_idx").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
]);

export const followUps = pgTable("follow_ups", {
	id: serial().primaryKey().notNull(),
	prospectId: integer("prospect_id").notNull(),
	touchNumber: integer("touch_number").default(1).notNull(),
	scheduledFor: timestamp("scheduled_for", { withTimezone: true, mode: 'string' }).notNull(),
	status: varchar().default('pending').notNull(),
	body: text(),
	sentAt: timestamp("sent_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("follow_ups_prospect_id_idx").using("btree", table.prospectId.asc().nullsLast().op("int4_ops")),
	index("follow_ups_scheduled_for_idx").using("btree", table.scheduledFor.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.prospectId],
			foreignColumns: [prospects.id],
			name: "follow_ups_prospect_id_fkey"
		}),
]);

export const conversations = pgTable("conversations", {
	id: serial().primaryKey().notNull(),
	prospectId: integer("prospect_id").notNull(),
	direction: varchar({ length: 8 }).notNull(),
	body: text().notNull(),
	platform: varchar({ length: 32 }).default('linkedin').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	authorAgent: varchar("author_agent", { length: 40 }),
	intent: varchar({ length: 24 }),
}, (table) => [
	index("conversations_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("conversations_prospect_id_idx").using("btree", table.prospectId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.prospectId],
			foreignColumns: [prospects.id],
			name: "conversations_prospect_id_fkey"
		}).onDelete("cascade"),
	check("conversations_direction_check", sql`(direction)::text = ANY ((ARRAY['inbound'::character varying, 'outbound'::character varying])::text[])`),
]);

export const agents = pgTable("agents", {
	id: varchar({ length: 40 }).primaryKey().notNull(),
	name: varchar({ length: 80 }).notNull(),
	role: varchar({ length: 160 }).notNull(),
	autonomyTier: varchar("autonomy_tier", { length: 16 }).default('draft').notNull(),
	enabled: boolean().default(false).notNull(),
	status: varchar({ length: 16 }).default('off').notNull(),
	dailyCap: integer("daily_cap"),
	cohort: jsonb(),
	lastRunAt: timestamp("last_run_at", { withTimezone: true, mode: 'string' }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const meetingBriefs = pgTable("meeting_briefs", {
	id: serial().primaryKey().notNull(),
	prospectId: integer("prospect_id"),
	brief: jsonb().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.prospectId],
			foreignColumns: [prospects.id],
			name: "meeting_briefs_prospect_id_fkey"
		}).onDelete("cascade"),
]);

export const prospects = pgTable("prospects", {
	id: serial().primaryKey().notNull(),
	name: varchar().notNull(),
	title: varchar(),
	company: varchar(),
	vertical: enumProspectsVertical(),
	location: varchar(),
	degree: varchar(),
	mutuals: varchar(),
	niche: varchar(),
	hook: varchar(),
	profileUrl: varchar("profile_url"),
	fitScore: numeric("fit_score"),
	fitReason: varchar("fit_reason"),
	status: enumProspectsStatus().default('qualified'),
	source: varchar(),
	recon: jsonb(),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	paused: boolean().default(false),
	lifecycleStage: enumProspectsLifecycle("lifecycle_stage").default('prospect').notNull(),
	temperature: enumProspectsTemperature().default('cold').notNull(),
	digest: text(),
	facts: jsonb().default([]).notNull(),
	ownerAgent: varchar("owner_agent", { length: 40 }),
	consent: boolean().default(false).notNull(),
	doNotContact: boolean("do_not_contact").default(false).notNull(),
	followupEnabled: boolean("followup_enabled").default(true).notNull(),
	interestState: varchar("interest_state", { length: 24 }).default('unknown').notNull(),
	track: varchar({ length: 24 }).default('outreach').notNull(),
}, (table) => [
	index("prospects_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("prospects_updated_at_idx").using("btree", table.updatedAt.asc().nullsLast().op("timestamptz_ops")),
]);

export const agentTasks = pgTable("agent_tasks", {
	id: serial().primaryKey().notNull(),
	agent: varchar({ length: 40 }).notNull(),
	kind: varchar({ length: 40 }).notNull(),
	prospectId: integer("prospect_id"),
	instruction: text(),
	payload: jsonb(),
	status: varchar({ length: 16 }).default('queued').notNull(),
	result: jsonb(),
	error: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	processedAt: timestamp("processed_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("agent_tasks_prospect_idx").using("btree", table.prospectId.asc().nullsLast().op("int4_ops")),
	index("agent_tasks_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops"), table.createdAt.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.prospectId],
			foreignColumns: [prospects.id],
			name: "agent_tasks_prospect_id_fkey"
		}).onDelete("cascade"),
]);

export const siteAnalyses = pgTable("site_analyses", {
	id: serial().primaryKey().notNull(),
	url: text().notNull(),
	finalUrl: text("final_url"),
	status: text().default('analyzed').notNull(),
	businessName: text("business_name"),
	analysis: jsonb(),
	logoUrl: text("logo_url"),
	screenshotUrl: text("screenshot_url"),
	rebuildRequestId: integer("rebuild_request_id"),
	forgeSiteId: integer("forge_site_id"),
	requestedByUserId: text("requested_by_user_id"),
	error: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("site_analyses_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("site_analyses_url_idx").using("btree", table.url.asc().nullsLast().op("text_ops")),
]);

export const leads = pgTable("leads", {
	id: serial().primaryKey().notNull(),
	name: varchar().notNull(),
	email: varchar().notNull(),
	phone: varchar(),
	company: varchar(),
	role: varchar(),
	industry: varchar(),
	teamSize: enumLeadsTeamSize("team_size"),
	timeline: enumLeadsTimeline(),
	problem: varchar(),
	emailType: enumLeadsEmailType("email_type"),
	source: enumLeadsSource().notNull(),
	sourcePath: varchar("source_path"),
	status: enumLeadsStatus().default('new'),
	bookedSlot: varchar("booked_slot"),
	notes: varchar(),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	prospectId: integer("prospect_id"),
	gcalEventId: text("gcal_event_id"),
	gcalHtmlLink: text("gcal_html_link"),
	meetLink: text("meet_link"),
}, (table) => [
	index("leads_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("leads_email_idx").using("btree", table.email.asc().nullsLast().op("text_ops")),
	index("leads_updated_at_idx").using("btree", table.updatedAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.prospectId],
			foreignColumns: [prospects.id],
			name: "leads_prospect_id_fkey"
		}),
]);

export const rebuildRequests = pgTable("rebuild_requests", {
	id: serial().primaryKey().notNull(),
	existingUrl: text("existing_url").notNull(),
	businessName: text("business_name"),
	name: text(),
	email: text(),
	phone: text(),
	notes: text(),
	status: text().default('requested').notNull(),
	requestedByUserId: text("requested_by_user_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("rebuild_requests_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
]);

export const forgeSites = pgTable("forge_sites", {
	id: serial().primaryKey().notNull(),
	slug: text().notNull(),
	businessName: text("business_name").notNull(),
	niche: text(),
	city: text(),
	serviceArea: text("service_area"),
	phone: text(),
	email: text(),
	existingWebsiteUrl: text("existing_website_url"),
	brandColor: text("brand_color"),
	theme: text(),
	status: forgeSiteStatus().default('discovered').notNull(),
	fitReason: text("fit_reason"),
	source: text(),
	notes: text(),
	liveUrl: text("live_url"),
	screenshotUrl: text("screenshot_url"),
	buildStatus: text("build_status"),
	deniedReason: text("denied_reason"),
	approvedAt: timestamp("approved_at", { withTimezone: true, mode: 'string' }),
	builtAt: timestamp("built_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	googleRating: text("google_rating"),
	reviewCount: text("review_count"),
	googleMapsUrl: text("google_maps_url"),
	linkedinUrl: text("linkedin_url"),
	claimCode: text("claim_code"),
	claimedByUserId: text("claimed_by_user_id"),
	claimedAt: timestamp("claimed_at", { withTimezone: true, mode: 'string' }),
	plan: text(),
	stripeCustomerId: text("stripe_customer_id"),
	stripeSubscriptionId: text("stripe_subscription_id"),
	subscriptionStatus: text("subscription_status"),
	oneTimePaid: boolean("one_time_paid").default(false).notNull(),
	paidAt: timestamp("paid_at", { withTimezone: true, mode: 'string' }),
	domainCredits: integer("domain_credits").default(0).notNull(),
	domain: text(),
	domainStatus: text("domain_status"),
	outreachStatus: text("outreach_status").default('none').notNull(),
	outreachSubject: text("outreach_subject"),
	outreachDraft: text("outreach_draft"),
	outreachChannel: text("outreach_channel").default('email'),
	contactedAt: timestamp("contacted_at", { withTimezone: true, mode: 'string' }),
	outreachNotes: text("outreach_notes"),
}, (table) => [
	uniqueIndex("forge_sites_claim_code_key").using("btree", table.claimCode.asc().nullsLast().op("text_ops")),
	index("forge_sites_outreach_status_idx").using("btree", table.outreachStatus.asc().nullsLast().op("text_ops")),
	index("forge_sites_status_idx").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	unique("forge_sites_slug_key").on(table.slug),
]);

export const editRequests = pgTable("edit_requests", {
	id: serial().primaryKey().notNull(),
	siteId: integer("site_id").notNull(),
	requestedByUserId: text("requested_by_user_id"),
	markdown: text().notNull(),
	edits: jsonb(),
	status: text().default('requested').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("edit_requests_site_idx").using("btree", table.siteId.asc().nullsLast().op("int4_ops")),
	index("edit_requests_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
]);

export const forgeBlacklist = pgTable("forge_blacklist", {
	id: serial().primaryKey().notNull(),
	normKey: text("norm_key").notNull(),
	businessName: text("business_name").notNull(),
	city: text(),
	domain: text(),
	reason: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("forge_blacklist_domain_idx").using("btree", table.domain.asc().nullsLast().op("text_ops")),
	unique("forge_blacklist_norm_key_key").on(table.normKey),
]);
