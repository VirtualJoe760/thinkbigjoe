import { relations } from "drizzle-orm/relations";
import { prospects, outreach, followUps, conversations, meetingBriefs, agentTasks, leads, forgeSites, newsletterContacts, newsletters, contacts } from "./schema";

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

export const newsletterContactsRelations = relations(newsletterContacts, ({one}) => ({
	forgeSite: one(forgeSites, {
		fields: [newsletterContacts.siteId],
		references: [forgeSites.id]
	}),
}));

export const forgeSitesRelations = relations(forgeSites, ({many}) => ({
	newsletterContacts: many(newsletterContacts),
	newsletters: many(newsletters),
	contacts: many(contacts),
}));

export const newslettersRelations = relations(newsletters, ({one}) => ({
	forgeSite: one(forgeSites, {
		fields: [newsletters.siteId],
		references: [forgeSites.id]
	}),
}));

export const contactsRelations = relations(contacts, ({one}) => ({
	forgeSite: one(forgeSites, {
		fields: [contacts.siteId],
		references: [forgeSites.id]
	}),
}));