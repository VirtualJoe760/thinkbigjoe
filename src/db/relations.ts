import { relations } from "drizzle-orm/relations";
import { prospects, outreach, followUps, conversations, meetingBriefs, agentTasks, leads, forgeSites, newsletterContacts, contacts, newsletters, newsletterSends } from "./schema";

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
	contacts: many(contacts),
	newsletterSends: many(newsletterSends),
	newsletters: many(newsletters),
}));

export const contactsRelations = relations(contacts, ({one}) => ({
	forgeSite: one(forgeSites, {
		fields: [contacts.siteId],
		references: [forgeSites.id]
	}),
}));

export const newsletterSendsRelations = relations(newsletterSends, ({one}) => ({
	newsletter: one(newsletters, {
		fields: [newsletterSends.newsletterId],
		references: [newsletters.id]
	}),
	forgeSite: one(forgeSites, {
		fields: [newsletterSends.siteId],
		references: [forgeSites.id]
	}),
}));

export const newslettersRelations = relations(newsletters, ({one, many}) => ({
	newsletterSends: many(newsletterSends),
	forgeSite: one(forgeSites, {
		fields: [newsletters.siteId],
		references: [forgeSites.id]
	}),
}));