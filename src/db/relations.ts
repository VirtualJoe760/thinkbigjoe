import { relations } from "drizzle-orm/relations";
import { prospects, outreach, followUps, conversations, meetingBriefs, agentTasks, leads } from "./schema";

export const outreachRelations = relations(outreach, ({one}) => ({
	prospect: one(prospects, {
		fields: [outreach.prospectId],
		references: [prospects.id]
	}),
}));

export const prospectsRelations = relations(prospects, ({many}) => ({
	outreaches: many(outreach),
	followUps: many(followUps),
	conversations: many(conversations),
	meetingBriefs: many(meetingBriefs),
	agentTasks: many(agentTasks),
	leads: many(leads),
}));

export const followUpsRelations = relations(followUps, ({one}) => ({
	prospect: one(prospects, {
		fields: [followUps.prospectId],
		references: [prospects.id]
	}),
}));

export const conversationsRelations = relations(conversations, ({one}) => ({
	prospect: one(prospects, {
		fields: [conversations.prospectId],
		references: [prospects.id]
	}),
}));

export const meetingBriefsRelations = relations(meetingBriefs, ({one}) => ({
	prospect: one(prospects, {
		fields: [meetingBriefs.prospectId],
		references: [prospects.id]
	}),
}));

export const agentTasksRelations = relations(agentTasks, ({one}) => ({
	prospect: one(prospects, {
		fields: [agentTasks.prospectId],
		references: [prospects.id]
	}),
}));

export const leadsRelations = relations(leads, ({one}) => ({
	prospect: one(prospects, {
		fields: [leads.prospectId],
		references: [prospects.id]
	}),
}));