import { relations } from "drizzle-orm/relations";
import { prospects, outreach, followUps, conversations } from "./schema";

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