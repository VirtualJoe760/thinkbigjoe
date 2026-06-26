import { pgTable, serial, boolean, varchar, integer, date, timestamp, index, foreignKey, numeric, jsonb, text, check, pgEnum } from "drizzle-orm/pg-core"
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

export const conversations = pgTable("conversations", {
	id: serial().primaryKey().notNull(),
	prospectId: integer("prospect_id").notNull(),
	direction: varchar({ length: 8 }).notNull(),
	body: text().notNull(),
	platform: varchar({ length: 32 }).default('linkedin').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
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
