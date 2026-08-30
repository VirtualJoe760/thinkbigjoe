import { pgTable, serial, boolean, varchar, integer, date, timestamp, index, foreignKey, text, jsonb, check, numeric, unique, uniqueIndex, pgEnum } from "drizzle-orm/pg-core"
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
export const forgeSiteStatus = pgEnum("forge_site_status", ['discovered', 'approved', 'denied', 'building', 'built', 'build_failed', 'deleted'])


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
	index("agent_tasks_agent_status_idx").using("btree", table.agent.asc().nullsLast().op("text_ops"), table.status.asc().nullsLast().op("text_ops"), table.createdAt.asc().nullsLast().op("text_ops")),
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

export const leadEngine = pgTable("lead_engine", {
	id: serial().primaryKey().notNull(),
	monthlyLeadGoal: integer("monthly_lead_goal").default(2500).notNull(),
	monthlyBudgetUsd: numeric("monthly_budget_usd").default('25').notNull(),
	enabled: boolean().default(true).notNull(),
	comboOffset: integer("combo_offset").default(0).notNull(),
	spendMonth: text("spend_month"),
	spendUsd: numeric("spend_usd").default('0').notNull(),
	lastRunAt: timestamp("last_run_at", { withTimezone: true, mode: 'string' }),
	lastRunSummary: text("last_run_summary"),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

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

export const jobRequests = pgTable("job_requests", {
	id: serial().primaryKey().notNull(),
	kind: text().notNull(),
	status: text().default('pending').notNull(),
	requestedBy: text("requested_by"),
	note: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }),
	finishedAt: timestamp("finished_at", { withTimezone: true, mode: 'string' }),
});

export const templates = pgTable("templates", {
	id: text().primaryKey().notNull(),
	dir: text().notNull(),
	language: text(),
	name: text().notNull(),
	description: text(),
	bestFor: text("best_for"),
	previewPath: text("preview_path"),
	enabled: boolean().default(false).notNull(),
	builtBy: text("built_by"),
	builtAt: text("built_at"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	design: jsonb(),
	archived: boolean().default(false).notNull(),
});

export const previewEngine = pgTable("preview_engine", {
	id: serial().primaryKey().notNull(),
	dailyBudget: integer("daily_budget").default(30).notNull(),
	enabled: boolean().default(true).notNull(),
	lastRunAt: timestamp("last_run_at", { withTimezone: true, mode: 'string' }),
	lastRunSummary: text("last_run_summary"),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const outreachEngine = pgTable("outreach_engine", {
	id: serial().primaryKey().notNull(),
	dailyGoal: integer("daily_goal").default(15).notNull(),
	enabled: boolean().default(true).notNull(),
	lastRunAt: timestamp("last_run_at", { withTimezone: true, mode: 'string' }),
	lastRunSummary: text("last_run_summary"),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const designReports = pgTable("design_reports", {
	id: serial().primaryKey().notNull(),
	vertical: text().notNull(),
	archetype: text(),
	title: text().notNull(),
	summary: text().notNull(),
	findings: jsonb(),
	sources: jsonb(),
	languageId: text("language_id"),
	spec: jsonb(),
	status: text().default('proposed').notNull(),
	verifiedAt: timestamp("verified_at", { withTimezone: true, mode: 'string' }),
	verifiedBy: text("verified_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("design_reports_created_idx").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
]);

export const forgeEngine = pgTable("forge_engine", {
	id: serial().primaryKey().notNull(),
	enabled: boolean().default(false).notNull(),
	avgBuildMinutes: integer("avg_build_minutes").default(12).notNull(),
	lastRunAt: timestamp("last_run_at", { withTimezone: true, mode: 'string' }),
	lastRunSummary: text("last_run_summary"),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	buildsEnabled: boolean("builds_enabled").default(true).notNull(),
	editsEnabled: boolean("edits_enabled").default(true).notNull(),
	idleTemplatesEnabled: boolean("idle_templates_enabled").default(false).notNull(),
	weeklyRunBudget: integer("weekly_run_budget").default(40).notNull(),
	templatesPerDay: integer("templates_per_day").default(2).notNull(),
	lastTemplateAt: timestamp("last_template_at", { withTimezone: true, mode: 'string' }),
	lastWarnPct: integer("last_warn_pct").default(0).notNull(),
	lastWarnWeek: text("last_warn_week"),
});

export const forgeReplies = pgTable("forge_replies", {
	id: serial().primaryKey().notNull(),
	siteId: integer("site_id").notNull(),
	fromEmail: text("from_email"),
	subject: text(),
	inboundText: text("inbound_text"),
	draft: text(),
	finalText: text("final_text"),
	status: text().default('awaiting').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("forge_replies_site_idx").using("btree", table.siteId.asc().nullsLast().op("int4_ops")),
	index("forge_replies_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
]);

export const smsConversations = pgTable("sms_conversations", {
	id: serial().primaryKey().notNull(),
	contactPhone: varchar("contact_phone").notNull(),
	lastInboundAt: timestamp("last_inbound_at", { withTimezone: true, mode: 'string' }),
	lastOutboundAt: timestamp("last_outbound_at", { withTimezone: true, mode: 'string' }),
	lastDirection: varchar("last_direction", { length: 8 }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("sms_conversations_last_inbound_idx").using("btree", table.lastInboundAt.desc().nullsFirst().op("timestamptz_ops")),
	unique("sms_conversations_contact_phone_key").on(table.contactPhone),
]);

export const callbackCodes = pgTable("callback_codes", {
	id: serial().primaryKey().notNull(),
	code: varchar().notNull(),
	contactPhone: varchar("contact_phone"),
	leadName: varchar("lead_name"),
	forgeSiteId: integer("forge_site_id"),
	status: varchar({ length: 12 }).default('active').notNull(),
	issuedBy: varchar("issued_by").default('venus'),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }),
	usedAt: timestamp("used_at", { withTimezone: true, mode: 'string' }),
	usedCount: integer("used_count").default(0).notNull(),
	usedCallId: varchar("used_call_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("callback_codes_active_code_idx").using("btree", table.code.asc().nullsLast().op("text_ops")).where(sql`((status)::text = 'active'::text)`),
	index("callback_codes_contact_idx").using("btree", table.contactPhone.asc().nullsLast().op("text_ops")),
]);

export const contactOverrides = pgTable("contact_overrides", {
	phone: text().primaryKey().notNull(),
	displayName: text("display_name").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const newsletterContacts = pgTable("newsletter_contacts", {
	id: serial().primaryKey().notNull(),
	siteId: integer("site_id").notNull(),
	email: text().notNull(),
	name: text(),
	status: text().default('subscribed').notNull(),
	unsubscribeToken: text("unsubscribe_token").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("newsletter_contacts_site_idx").using("btree", table.siteId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.siteId],
			foreignColumns: [forgeSites.id],
			name: "newsletter_contacts_site_id_fkey"
		}).onDelete("cascade"),
	unique("newsletter_contacts_site_id_email_key").on(table.siteId, table.email),
	unique("newsletter_contacts_unsubscribe_token_key").on(table.unsubscribeToken),
]);

export const contacts = pgTable("contacts", {
	id: serial().primaryKey().notNull(),
	siteId: integer("site_id"),
	role: text().default('owner').notNull(),
	lifecycle: text().default('prospect').notNull(),
	businessName: text("business_name"),
	name: text(),
	email: text(),
	phone: text(),
	address: text(),
	city: text(),
	serviceArea: text("service_area"),
	websiteUrl: text("website_url"),
	instagramUrl: text("instagram_url"),
	facebookUrl: text("facebook_url"),
	linkedinUrl: text("linkedin_url"),
	notes: text(),
	source: text(),
	doNotContact: boolean("do_not_contact").default(false).notNull(),
	emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true, mode: 'string' }),
	enrichedAt: timestamp("enriched_at", { withTimezone: true, mode: 'string' }),
	userId: text("user_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("contacts_email_idx").using("btree", sql`lower(email)`),
	index("contacts_site_idx").using("btree", table.siteId.asc().nullsLast().op("int4_ops")),
	uniqueIndex("contacts_site_owner_key").using("btree", table.siteId.asc().nullsLast().op("int4_ops")).where(sql`(role = 'owner'::text)`),
	index("contacts_user_idx").using("btree", table.userId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.siteId],
			foreignColumns: [forgeSites.id],
			name: "contacts_site_id_fkey"
		}).onDelete("set null"),
]);

export const googleConnections = pgTable("google_connections", {
	id: serial().primaryKey().notNull(),
	userId: text("user_id").notNull(),
	siteId: integer("site_id"),
	googleEmail: text("google_email"),
	accessToken: text("access_token").notNull(),
	refreshToken: text("refresh_token"),
	scope: text(),
	tokenExpiry: timestamp("token_expiry", { withTimezone: true, mode: 'string' }),
	calendarConnected: boolean("calendar_connected").default(false).notNull(),
	contactsConnected: boolean("contacts_connected").default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	bookingLabel: text("booking_label").default('Website & AI bookings'),
}, (table) => [
	unique("google_connections_user_id_key").on(table.userId),
]);

export const emailSuppressions = pgTable("email_suppressions", {
	id: serial().primaryKey().notNull(),
	email: text().notNull(),
	reason: text().default('bounce').notNull(),
	detail: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("email_suppressions_email_key").using("btree", sql`lower(email)`),
]);

export const newsletterSends = pgTable("newsletter_sends", {
	id: serial().primaryKey().notNull(),
	newsletterId: integer("newsletter_id").notNull(),
	siteId: integer("site_id"),
	email: text().notNull(),
	name: text(),
	status: text().default('queued').notNull(),
	attempts: integer().default(0).notNull(),
	error: text(),
	messageId: text("message_id"),
	sentAt: timestamp("sent_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("newsletter_sends_msgid_idx").using("btree", table.messageId.asc().nullsLast().op("text_ops")),
	uniqueIndex("newsletter_sends_nl_email_key").using("btree", sql`newsletter_id`, sql`lower(email)`),
	index("newsletter_sends_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.newsletterId],
			foreignColumns: [newsletters.id],
			name: "newsletter_sends_newsletter_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.siteId],
			foreignColumns: [forgeSites.id],
			name: "newsletter_sends_site_id_fkey"
		}).onDelete("set null"),
]);

export const newsletters = pgTable("newsletters", {
	id: serial().primaryKey().notNull(),
	siteId: integer("site_id").notNull(),
	period: text().notNull(),
	subject: text().notNull(),
	bodyHtml: text("body_html").notNull(),
	status: text().default('draft').notNull(),
	recipientCount: integer("recipient_count").default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	sentAt: timestamp("sent_at", { withTimezone: true, mode: 'string' }),
	prompt: text(),
	bannerUrl: text("banner_url"),
}, (table) => [
	index("newsletters_site_idx").using("btree", table.siteId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.siteId],
			foreignColumns: [forgeSites.id],
			name: "newsletters_site_id_fkey"
		}).onDelete("cascade"),
]);

export const voiceLines = pgTable("voice_lines", {
	id: serial().primaryKey().notNull(),
	phoneNumber: text("phone_number").notNull(),
	siteId: integer("site_id").notNull(),
	status: text().default('provisioning').notNull(),
	retellAgentId: text("retell_agent_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("voice_lines_site_idx").using("btree", table.siteId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.siteId],
			foreignColumns: [forgeSites.id],
			name: "voice_lines_site_id_fkey"
		}),
	unique("voice_lines_phone_number_key").on(table.phoneNumber),
]);

export const voiceOnboarding = pgTable("voice_onboarding", {
	id: serial().primaryKey().notNull(),
	siteId: integer("site_id").notNull(),
	userId: text("user_id"),
	code: text().notNull(),
	sentTo: text("sent_to").notNull(),
	channel: text().notNull(),
	status: text().default('pending').notNull(),
	attempts: integer().default(0).notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	verifiedAt: timestamp("verified_at", { withTimezone: true, mode: 'string' }),
	retellCallId: text("retell_call_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("voice_onboarding_live_idx").using("btree", table.siteId.asc().nullsLast().op("int4_ops")).where(sql`(status = 'pending'::text)`),
	index("voice_onboarding_site_idx").using("btree", table.siteId.asc().nullsLast().op("int4_ops"), table.createdAt.desc().nullsFirst().op("int4_ops")),
	foreignKey({
			columns: [table.siteId],
			foreignColumns: [forgeSites.id],
			name: "voice_onboarding_site_id_fkey"
		}),
]);

export const calls = pgTable("calls", {
	id: serial().primaryKey().notNull(),
	siteId: integer("site_id").notNull(),
	retellCallId: text("retell_call_id"),
	fromNumber: text("from_number"),
	toNumber: text("to_number"),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }),
	endedAt: timestamp("ended_at", { withTimezone: true, mode: 'string' }),
	durationSec: integer("duration_sec"),
	callerName: text("caller_name"),
	callbackNumber: text("callback_number"),
	address: text(),
	problem: text(),
	urgency: text(),
	isRealLead: boolean("is_real_lead"),
	summary: text(),
	transcript: text(),
	disposition: text(),
	recordingUrl: text("recording_url"),
	notifiedAt: timestamp("notified_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	ownerRating: text("owner_rating"),
	ownerNote: text("owner_note"),
	ownerRatedAt: timestamp("owner_rated_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("calls_owner_rating_idx").using("btree", table.ownerRating.asc().nullsLast().op("text_ops")).where(sql`(owner_rating IS NOT NULL)`),
	index("calls_site_started_idx").using("btree", table.siteId.asc().nullsLast().op("int4_ops"), table.startedAt.desc().nullsFirst().op("int4_ops")),
	foreignKey({
			columns: [table.siteId],
			foreignColumns: [forgeSites.id],
			name: "calls_site_id_fkey"
		}),
	unique("calls_retell_call_id_key").on(table.retellCallId),
]);

export const autoProvision = pgTable("auto_provision", {
	id: serial().primaryKey().notNull(),
	enabled: boolean().default(false).notNull(),
	weeklyLineBudget: integer("weekly_line_budget").default(10).notNull(),
	autoBuildEnabled: boolean("auto_build_enabled").default(false).notNull(),
	lastWarnPct: integer("last_warn_pct").default(0).notNull(),
	lastWarnWeek: text("last_warn_week"),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const voiceProvisionQueue = pgTable("voice_provision_queue", {
	id: serial().primaryKey().notNull(),
	siteId: integer("site_id").notNull(),
	status: text().default('queued').notNull(),
	queuedAt: timestamp("queued_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	attempts: integer().default(0).notNull(),
	lastError: text("last_error"),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("voice_provision_queue_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.siteId],
			foreignColumns: [forgeSites.id],
			name: "voice_provision_queue_site_id_fkey"
		}),
	unique("voice_provision_queue_site_id_key").on(table.siteId),
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
	utmSource: text("utm_source"),
	utmMedium: text("utm_medium"),
	utmCampaign: text("utm_campaign"),
	utmContent: text("utm_content"),
	utmTerm: text("utm_term"),
	fbclid: text(),
	referrer: text(),
	landingPath: text("landing_path"),
}, (table) => [
	index("leads_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("leads_email_idx").using("btree", table.email.asc().nullsLast().op("text_ops")),
	index("leads_updated_at_idx").using("btree", table.updatedAt.asc().nullsLast().op("timestamptz_ops")),
	index("leads_utm_campaign_idx").using("btree", table.utmCampaign.asc().nullsLast().op("text_ops")).where(sql`(utm_campaign IS NOT NULL)`),
	foreignKey({
			columns: [table.prospectId],
			foreignColumns: [prospects.id],
			name: "leads_prospect_id_fkey"
		}),
]);

export const organizations = pgTable("organizations", {
	id: serial().primaryKey().notNull(),
	name: text().notNull(),
	slug: text().notNull(),
	ownerUserId: text("owner_user_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	accountNumber: text("account_number"),
}, (table) => [
	unique("organizations_slug_key").on(table.slug),
]);

export const agentMessages = pgTable("agent_messages", {
	id: serial().primaryKey().notNull(),
	agentId: varchar("agent_id", { length: 40 }).notNull(),
	direction: text().notNull(),
	body: text().notNull(),
	status: text().default('queued').notNull(),
	replyTo: integer("reply_to"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("agent_messages_agent_idx").using("btree", table.agentId.asc().nullsLast().op("text_ops"), table.createdAt.asc().nullsLast().op("text_ops")),
	index("agent_messages_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")).where(sql`(status = 'queued'::text)`),
	foreignKey({
			columns: [table.replyTo],
			foreignColumns: [table.id],
			name: "agent_messages_reply_to_fkey"
		}),
	check("agent_messages_direction_check", sql`direction = ANY (ARRAY['to_agent'::text, 'from_agent'::text])`),
	check("agent_messages_status_check", sql`status = ANY (ARRAY['queued'::text, 'answered'::text, 'failed'::text, 'received'::text])`),
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
	followupCount: integer("followup_count").default(0).notNull(),
	ownerName: text("owner_name"),
	instagramUrl: text("instagram_url"),
	facebookUrl: text("facebook_url"),
	contactNotes: text("contact_notes"),
	contactEnrichedAt: timestamp("contact_enriched_at", { withTimezone: true, mode: 'string' }),
	socialStats: jsonb("social_stats"),
	reviewQuotes: jsonb("review_quotes"),
	callPrep: text("call_prep"),
	callPrepAt: timestamp("call_prep_at", { withTimezone: true, mode: 'string' }),
	photoUrl: text("photo_url"),
	preferredTemplate: text("preferred_template"),
	marketingApprovedAt: timestamp("marketing_approved_at", { withTimezone: true, mode: 'string' }),
	revisionNote: text("revision_note"),
	revisionRequestedAt: timestamp("revision_requested_at", { withTimezone: true, mode: 'string' }),
	idVerifiedAt: timestamp("id_verified_at", { withTimezone: true, mode: 'string' }),
	idVerificationSession: text("id_verification_session"),
	preview: jsonb(),
	previewGeneratedAt: timestamp("preview_generated_at", { withTimezone: true, mode: 'string' }),
	previewScrapedAt: timestamp("preview_scraped_at", { withTimezone: true, mode: 'string' }),
	previewExpiresAt: timestamp("preview_expires_at", { withTimezone: true, mode: 'string' }),
	receptionistConfig: jsonb("receptionist_config"),
	receptionistStatus: text("receptionist_status").default('none'),
	themeOverrides: jsonb("theme_overrides"),
	aiPaused: boolean("ai_paused").default(false).notNull(),
	leadStage: text("lead_stage"),
	declinedAt: timestamp("declined_at", { withTimezone: true, mode: 'string' }),
	siteDeletedAt: timestamp("site_deleted_at", { withTimezone: true, mode: 'string' }),
	callbackAt: timestamp("callback_at", { withTimezone: true, mode: 'string' }),
	callbackNote: text("callback_note"),
	callbackRemindedAt: timestamp("callback_reminded_at", { withTimezone: true, mode: 'string' }),
	vmTextPending: boolean("vm_text_pending").default(false).notNull(),
	vmDroppedAt: timestamp("vm_dropped_at", { withTimezone: true, mode: 'string' }),
	bookingTimezone: text("booking_timezone").default('America/New_York').notNull(),
	address: text(),
	isInternal: boolean("is_internal").default(false).notNull(),
	orgId: integer("org_id"),
	phoneBadAt: timestamp("phone_bad_at", { withTimezone: true, mode: 'string' }),
	phoneBadNote: text("phone_bad_note"),
}, (table) => [
	uniqueIndex("forge_sites_claim_code_key").using("btree", table.claimCode.asc().nullsLast().op("text_ops")),
	index("forge_sites_outreach_status_idx").using("btree", table.outreachStatus.asc().nullsLast().op("text_ops")),
	index("forge_sites_status_idx").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "forge_sites_org_id_fkey"
		}),
	unique("forge_sites_slug_key").on(table.slug),
]);

export const candidateFacts = pgTable("candidate_facts", {
	id: serial().primaryKey().notNull(),
	topic: varchar({ length: 60 }).notNull(),
	fact: text().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("candidate_facts_topic_key").on(table.topic),
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
	orgId: integer("org_id"),
	model: text(),
	workspace: text(),
	archived: boolean().default(false).notNull(),
	paused: boolean().default(false).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "agents_org_id_fkey"
		}),
]);

export const agentQuestions = pgTable("agent_questions", {
	id: serial().primaryKey().notNull(),
	applicationId: integer("application_id"),
	agent: varchar({ length: 40 }).default('whitney').notNull(),
	question: text().notNull(),
	answer: text(),
	status: varchar({ length: 16 }).default('open').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	answeredAt: timestamp("answered_at", { withTimezone: true, mode: 'string' }),
	options: jsonb(),
	topic: varchar({ length: 60 }),
}, (table) => [
	index("agent_questions_application_idx").using("btree", table.applicationId.asc().nullsLast().op("int4_ops")),
	index("agent_questions_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.applicationId],
			foreignColumns: [jobApplications.id],
			name: "agent_questions_application_id_fkey"
		}).onDelete("cascade"),
]);

export const emailOutbox = pgTable("email_outbox", {
	id: serial().primaryKey().notNull(),
	toAddr: text("to_addr").notNull(),
	ccAddr: text("cc_addr"),
	subject: text().notNull(),
	body: text().notNull(),
	inReplyTo: text("in_reply_to"),
	context: text(),
	sendAt: timestamp("send_at", { withTimezone: true, mode: 'string' }),
	status: text().default('pending').notNull(),
	requestedBy: text("requested_by").default('edward').notNull(),
	decidedBy: text("decided_by"),
	decidedAt: timestamp("decided_at", { withTimezone: true, mode: 'string' }),
	decisionNote: text("decision_note"),
	sentAt: timestamp("sent_at", { withTimezone: true, mode: 'string' }),
	error: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("email_outbox_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops"), table.sendAt.asc().nullsLast().op("text_ops")),
]);

export const jobApplications = pgTable("job_applications", {
	id: serial().primaryKey().notNull(),
	company: text().notNull(),
	role: text().notNull(),
	platform: varchar({ length: 40 }),
	url: text(),
	location: text(),
	pay: text(),
	fitReason: text("fit_reason"),
	status: varchar({ length: 24 }).default('found').notNull(),
	priority: integer().default(0).notNull(),
	notes: text(),
	approvedAt: timestamp("approved_at", { withTimezone: true, mode: 'string' }),
	appliedAt: timestamp("applied_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	jobDescription: text("job_description"),
	companyAbout: text("company_about"),
	companyAddress: text("company_address"),
	companyWebsite: text("company_website"),
	companyReviews: jsonb("company_reviews"),
	contactInfo: jsonb("contact_info"),
	fitScore: integer("fit_score"),
	interestScore: integer("interest_score"),
	interestMatch: text("interest_match"),
	directed: boolean().default(false).notNull(),
}, (table) => [
	index("job_applications_created_at_idx").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("job_applications_priority_idx").using("btree", table.priority.desc().nullsFirst().op("int4_ops"), table.approvedAt.asc().nullsLast().op("int4_ops")),
	index("job_applications_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
]);

export const agentDirectives = pgTable("agent_directives", {
	id: serial().primaryKey().notNull(),
	agent: varchar({ length: 40 }).notNull(),
	request: text().notNull(),
	context: text(),
	status: varchar({ length: 16 }).default('open').notNull(),
	result: text(),
	createdBy: varchar("created_by", { length: 40 }).default('joe').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("agent_directives_agent_status_idx").using("btree", table.agent.asc().nullsLast().op("text_ops"), table.status.asc().nullsLast().op("text_ops"), table.createdAt.asc().nullsLast().op("timestamptz_ops")),
]);

export const gigs = pgTable("gigs", {
	id: serial().primaryKey().notNull(),
	title: text().notNull(),
	client: text(),
	url: text(),
	platform: varchar({ length: 24 }).default('upwork').notNull(),
	lane: varchar({ length: 24 }).default('ai-agent').notNull(),
	budget: text(),
	scope: text(),
	description: text(),
	proposalsSoFar: integer("proposals_so_far"),
	clientHires: integer("client_hires"),
	clientVerified: boolean("client_verified"),
	fitScore: integer("fit_score"),
	winScore: integer("win_score"),
	fitReason: text("fit_reason"),
	winReason: text("win_reason"),
	proposal: text(),
	proposalDraftedAt: timestamp("proposal_drafted_at", { withTimezone: true, mode: 'string' }),
	status: varchar({ length: 24 }).default('found').notNull(),
	notes: text(),
	postedAt: timestamp("posted_at", { withTimezone: true, mode: 'string' }),
	approvedAt: timestamp("approved_at", { withTimezone: true, mode: 'string' }),
	submittedAt: timestamp("submitted_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("gigs_created_at_idx").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("gigs_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	uniqueIndex("gigs_url_uniq").using("btree", table.url.asc().nullsLast().op("text_ops")).where(sql`(url IS NOT NULL)`),
	index("gigs_win_idx").using("btree", table.winScore.desc().nullsLast().op("int4_ops"), table.fitScore.desc().nullsLast().op("int4_ops")),
]);
