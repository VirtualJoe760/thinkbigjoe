import { relations } from "drizzle-orm/relations";
import { payloadLockedDocuments, payloadLockedDocumentsRels, users, media, pages, leads, prospects, outreach, usersSessions, payloadPreferences, payloadPreferencesRels } from "./schema";

export const payloadLockedDocumentsRelsRelations = relations(payloadLockedDocumentsRels, ({one}) => ({
	payloadLockedDocument: one(payloadLockedDocuments, {
		fields: [payloadLockedDocumentsRels.parentId],
		references: [payloadLockedDocuments.id]
	}),
	user: one(users, {
		fields: [payloadLockedDocumentsRels.usersId],
		references: [users.id]
	}),
	media: one(media, {
		fields: [payloadLockedDocumentsRels.mediaId],
		references: [media.id]
	}),
	page: one(pages, {
		fields: [payloadLockedDocumentsRels.pagesId],
		references: [pages.id]
	}),
	lead: one(leads, {
		fields: [payloadLockedDocumentsRels.leadsId],
		references: [leads.id]
	}),
	prospect: one(prospects, {
		fields: [payloadLockedDocumentsRels.prospectsId],
		references: [prospects.id]
	}),
	outreach: one(outreach, {
		fields: [payloadLockedDocumentsRels.outreachId],
		references: [outreach.id]
	}),
}));

export const payloadLockedDocumentsRelations = relations(payloadLockedDocuments, ({many}) => ({
	payloadLockedDocumentsRels: many(payloadLockedDocumentsRels),
}));

export const usersRelations = relations(users, ({many}) => ({
	payloadLockedDocumentsRels: many(payloadLockedDocumentsRels),
	usersSessions: many(usersSessions),
	payloadPreferencesRels: many(payloadPreferencesRels),
}));

export const mediaRelations = relations(media, ({many}) => ({
	payloadLockedDocumentsRels: many(payloadLockedDocumentsRels),
}));

export const pagesRelations = relations(pages, ({many}) => ({
	payloadLockedDocumentsRels: many(payloadLockedDocumentsRels),
}));

export const leadsRelations = relations(leads, ({many}) => ({
	payloadLockedDocumentsRels: many(payloadLockedDocumentsRels),
}));

export const prospectsRelations = relations(prospects, ({many}) => ({
	payloadLockedDocumentsRels: many(payloadLockedDocumentsRels),
	outreaches: many(outreach),
}));

export const outreachRelations = relations(outreach, ({one, many}) => ({
	payloadLockedDocumentsRels: many(payloadLockedDocumentsRels),
	prospect: one(prospects, {
		fields: [outreach.prospectId],
		references: [prospects.id]
	}),
}));

export const usersSessionsRelations = relations(usersSessions, ({one}) => ({
	user: one(users, {
		fields: [usersSessions.parentId],
		references: [users.id]
	}),
}));

export const payloadPreferencesRelsRelations = relations(payloadPreferencesRels, ({one}) => ({
	payloadPreference: one(payloadPreferences, {
		fields: [payloadPreferencesRels.parentId],
		references: [payloadPreferences.id]
	}),
	user: one(users, {
		fields: [payloadPreferencesRels.usersId],
		references: [users.id]
	}),
}));

export const payloadPreferencesRelations = relations(payloadPreferences, ({many}) => ({
	payloadPreferencesRels: many(payloadPreferencesRels),
}));