import { relations } from "drizzle-orm/relations";
import { prospects, outreach, followUps, conversations, meetingBriefs, agentTasks, forgeSites, newsletterContacts, contacts, newsletters, newsletterSends, voiceLines, voiceOnboarding, calls, voiceProvisionQueue, leads, organizations, agents, agentMessages } from "./schema";

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

export const newsletterContactsRelations = relations(newsletterContacts, ({one}) => ({
	forgeSite: one(forgeSites, {
		fields: [newsletterContacts.siteId],
		references: [forgeSites.id]
	}),
}));

export const forgeSitesRelations = relations(forgeSites, ({one, many}) => ({
	newsletterContacts: many(newsletterContacts),
	contacts: many(contacts),
	newsletterSends: many(newsletterSends),
	newsletters: many(newsletters),
	voiceLines: many(voiceLines),
	voiceOnboardings: many(voiceOnboarding),
	calls: many(calls),
	voiceProvisionQueues: many(voiceProvisionQueue),
	organization: one(organizations, {
		fields: [forgeSites.orgId],
		references: [organizations.id]
	}),
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

export const voiceLinesRelations = relations(voiceLines, ({one}) => ({
	forgeSite: one(forgeSites, {
		fields: [voiceLines.siteId],
		references: [forgeSites.id]
	}),
}));

export const voiceOnboardingRelations = relations(voiceOnboarding, ({one}) => ({
	forgeSite: one(forgeSites, {
		fields: [voiceOnboarding.siteId],
		references: [forgeSites.id]
	}),
}));

export const callsRelations = relations(calls, ({one}) => ({
	forgeSite: one(forgeSites, {
		fields: [calls.siteId],
		references: [forgeSites.id]
	}),
}));

export const voiceProvisionQueueRelations = relations(voiceProvisionQueue, ({one}) => ({
	forgeSite: one(forgeSites, {
		fields: [voiceProvisionQueue.siteId],
		references: [forgeSites.id]
	}),
}));

export const leadsRelations = relations(leads, ({one}) => ({
	prospect: one(prospects, {
		fields: [leads.prospectId],
		references: [prospects.id]
	}),
}));

export const agentsRelations = relations(agents, ({one}) => ({
	organization: one(organizations, {
		fields: [agents.orgId],
		references: [organizations.id]
	}),
}));

export const organizationsRelations = relations(organizations, ({many}) => ({
	agents: many(agents),
	forgeSites: many(forgeSites),
}));

export const agentMessagesRelations = relations(agentMessages, ({one, many}) => ({
	agentMessage: one(agentMessages, {
		fields: [agentMessages.replyTo],
		references: [agentMessages.id],
		relationName: "agentMessages_replyTo_agentMessages_id"
	}),
	agentMessages: many(agentMessages, {
		relationName: "agentMessages_replyTo_agentMessages_id"
	}),
}));