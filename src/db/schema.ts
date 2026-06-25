import { pgTable, index, serial, varchar, timestamp, uniqueIndex, jsonb, numeric, foreignKey, integer, boolean, date, text, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const enumLeadsEmailType = pgEnum("enum_leads_email_type", ['business', 'free'])
export const enumLeadsSource = pgEnum("enum_leads_source", ['industry-page', 'booking-page', 'contact-form'])
export const enumLeadsStatus = pgEnum("enum_leads_status", ['new', 'booked', 'contacted', 'qualified', 'won', 'lost'])
export const enumLeadsTeamSize = pgEnum("enum_leads_team_size", ['1', '2-10', '11-50', '51-200', '200+'])
export const enumLeadsTimeline = pgEnum("enum_leads_timeline", ['asap', 'quarter', 'year', 'exploring'])
export const enumOutreachStatus = pgEnum("enum_outreach_status", ['draft', 'approved', 'edited', 'denied', 'sent'])
export const enumOutreachStep = pgEnum("enum_outreach_step", ['connection', 'diagnostic', 'reflect', 'invite', 'followup'])
export const enumPagesStatus = pgEnum("enum_pages_status", ['draft', 'published'])
export const enumProspectsStatus = pgEnum("enum_prospects_status", ['new', 'qualified', 'note_ready', 'connected', 'diagnostic_sent', 'replied', 'invited', 'prepped', 'meeting', 'won', 'lost', 'disqualified'])
export const enumProspectsVertical = pgEnum("enum_prospects_vertical", ['insurance', 'mortgage', 'wealth', 'msp', 'law', 'other'])


export const payloadLockedDocuments = pgTable("payload_locked_documents", {
	id: serial().primaryKey().notNull(),
	globalSlug: varchar("global_slug"),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("payload_locked_documents_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("payload_locked_documents_global_slug_idx").using("btree", table.globalSlug.asc().nullsLast().op("text_ops")),
	index("payload_locked_documents_updated_at_idx").using("btree", table.updatedAt.asc().nullsLast().op("timestamptz_ops")),
]);

export const pages = pgTable("pages", {
	id: serial().primaryKey().notNull(),
	title: varchar().notNull(),
	slug: varchar().notNull(),
	status: enumPagesStatus().default('draft'),
	content: jsonb(),
	metaTitle: varchar("meta_title"),
	metaDescription: varchar("meta_description"),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("pages_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	uniqueIndex("pages_slug_idx").using("btree", table.slug.asc().nullsLast().op("text_ops")),
	index("pages_updated_at_idx").using("btree", table.updatedAt.asc().nullsLast().op("timestamptz_ops")),
]);

export const payloadPreferences = pgTable("payload_preferences", {
	id: serial().primaryKey().notNull(),
	key: varchar(),
	value: jsonb(),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("payload_preferences_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("payload_preferences_key_idx").using("btree", table.key.asc().nullsLast().op("text_ops")),
	index("payload_preferences_updated_at_idx").using("btree", table.updatedAt.asc().nullsLast().op("timestamptz_ops")),
]);

export const payloadKv = pgTable("payload_kv", {
	id: serial().primaryKey().notNull(),
	key: varchar().notNull(),
	data: jsonb().notNull(),
}, (table) => [
	uniqueIndex("payload_kv_key_idx").using("btree", table.key.asc().nullsLast().op("text_ops")),
]);

export const media = pgTable("media", {
	id: serial().primaryKey().notNull(),
	alt: varchar().notNull(),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	url: varchar(),
	thumbnailURL: varchar("thumbnail_u_r_l"),
	filename: varchar(),
	mimeType: varchar("mime_type"),
	filesize: numeric(),
	width: numeric(),
	height: numeric(),
	focalX: numeric("focal_x"),
	focalY: numeric("focal_y"),
}, (table) => [
	index("media_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	uniqueIndex("media_filename_idx").using("btree", table.filename.asc().nullsLast().op("text_ops")),
	index("media_updated_at_idx").using("btree", table.updatedAt.asc().nullsLast().op("timestamptz_ops")),
]);

export const payloadLockedDocumentsRels = pgTable("payload_locked_documents_rels", {
	id: serial().primaryKey().notNull(),
	order: integer(),
	parentId: integer("parent_id").notNull(),
	path: varchar().notNull(),
	usersId: integer("users_id"),
	mediaId: integer("media_id"),
	pagesId: integer("pages_id"),
	leadsId: integer("leads_id"),
	prospectsId: integer("prospects_id"),
	outreachId: integer("outreach_id"),
}, (table) => [
	index("payload_locked_documents_rels_leads_id_idx").using("btree", table.leadsId.asc().nullsLast().op("int4_ops")),
	index("payload_locked_documents_rels_media_id_idx").using("btree", table.mediaId.asc().nullsLast().op("int4_ops")),
	index("payload_locked_documents_rels_order_idx").using("btree", table.order.asc().nullsLast().op("int4_ops")),
	index("payload_locked_documents_rels_outreach_id_idx").using("btree", table.outreachId.asc().nullsLast().op("int4_ops")),
	index("payload_locked_documents_rels_pages_id_idx").using("btree", table.pagesId.asc().nullsLast().op("int4_ops")),
	index("payload_locked_documents_rels_parent_idx").using("btree", table.parentId.asc().nullsLast().op("int4_ops")),
	index("payload_locked_documents_rels_path_idx").using("btree", table.path.asc().nullsLast().op("text_ops")),
	index("payload_locked_documents_rels_prospects_id_idx").using("btree", table.prospectsId.asc().nullsLast().op("int4_ops")),
	index("payload_locked_documents_rels_users_id_idx").using("btree", table.usersId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.parentId],
			foreignColumns: [payloadLockedDocuments.id],
			name: "payload_locked_documents_rels_parent_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.usersId],
			foreignColumns: [users.id],
			name: "payload_locked_documents_rels_users_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.mediaId],
			foreignColumns: [media.id],
			name: "payload_locked_documents_rels_media_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.pagesId],
			foreignColumns: [pages.id],
			name: "payload_locked_documents_rels_pages_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.leadsId],
			foreignColumns: [leads.id],
			name: "payload_locked_documents_rels_leads_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.prospectsId],
			foreignColumns: [prospects.id],
			name: "payload_locked_documents_rels_prospects_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.outreachId],
			foreignColumns: [outreach.id],
			name: "payload_locked_documents_rels_outreach_fk"
		}).onDelete("cascade"),
]);

export const users = pgTable("users", {
	id: serial().primaryKey().notNull(),
	name: varchar(),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	email: varchar().notNull(),
	resetPasswordToken: varchar("reset_password_token"),
	resetPasswordExpiration: timestamp("reset_password_expiration", { precision: 3, withTimezone: true, mode: 'string' }),
	salt: varchar(),
	hash: varchar(),
	loginAttempts: numeric("login_attempts").default('0'),
	lockUntil: timestamp("lock_until", { precision: 3, withTimezone: true, mode: 'string' }),
}, (table) => [
	index("users_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	uniqueIndex("users_email_idx").using("btree", table.email.asc().nullsLast().op("text_ops")),
	index("users_updated_at_idx").using("btree", table.updatedAt.asc().nullsLast().op("timestamptz_ops")),
]);

export const payloadMigrations = pgTable("payload_migrations", {
	id: serial().primaryKey().notNull(),
	name: varchar(),
	batch: numeric(),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("payload_migrations_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("payload_migrations_updated_at_idx").using("btree", table.updatedAt.asc().nullsLast().op("timestamptz_ops")),
]);

export const usersSessions = pgTable("users_sessions", {
	order: integer("_order").notNull(),
	parentId: integer("_parent_id").notNull(),
	id: varchar().primaryKey().notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }),
	expiresAt: timestamp("expires_at", { precision: 3, withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
	index("users_sessions_order_idx").using("btree", table.order.asc().nullsLast().op("int4_ops")),
	index("users_sessions_parent_id_idx").using("btree", table.parentId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.parentId],
			foreignColumns: [users.id],
			name: "users_sessions_parent_id_fk"
		}).onDelete("cascade"),
]);

export const payloadPreferencesRels = pgTable("payload_preferences_rels", {
	id: serial().primaryKey().notNull(),
	order: integer(),
	parentId: integer("parent_id").notNull(),
	path: varchar().notNull(),
	usersId: integer("users_id"),
}, (table) => [
	index("payload_preferences_rels_order_idx").using("btree", table.order.asc().nullsLast().op("int4_ops")),
	index("payload_preferences_rels_parent_idx").using("btree", table.parentId.asc().nullsLast().op("int4_ops")),
	index("payload_preferences_rels_path_idx").using("btree", table.path.asc().nullsLast().op("text_ops")),
	index("payload_preferences_rels_users_id_idx").using("btree", table.usersId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.parentId],
			foreignColumns: [payloadPreferences.id],
			name: "payload_preferences_rels_parent_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.usersId],
			foreignColumns: [users.id],
			name: "payload_preferences_rels_users_fk"
		}).onDelete("cascade"),
]);

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
}, (table) => [
	index("leads_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("leads_email_idx").using("btree", table.email.asc().nullsLast().op("text_ops")),
	index("leads_updated_at_idx").using("btree", table.updatedAt.asc().nullsLast().op("timestamptz_ops")),
]);

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

export const coworkJobs = pgTable("cowork_jobs", {
	id: serial().primaryKey().notNull(),
	source: varchar().default('telegram').notNull(),
	rawCommand: varchar("raw_command").notNull(),
	intent: varchar().default('unknown').notNull(),
	vertical: varchar(),
	location: varchar(),
	targetCount: integer("target_count"),
	status: varchar().default('queued').notNull(),
	resultSummary: varchar("result_summary"),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("cowork_jobs_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("cowork_jobs_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
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
}, (table) => [
	index("prospects_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("prospects_updated_at_idx").using("btree", table.updatedAt.asc().nullsLast().op("timestamptz_ops")),
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
