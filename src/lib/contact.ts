/**
 * The one place the Ivy phone number lives.
 *
 * It was inlined across the marketing site, the transfer page, and (soon) every portal "call Ivy"
 * panel. One constant so a number change is one edit, not a grep-and-pray. This is the RECEPTIONIST
 * line (Ivy) — distinct from TBJ_PHONE_PRETTY in callback-codes.ts, which is the A2P text/lead
 * number that also routes to her.
 */
export const IVY_PHONE_E164 = "+14807642121";
export const IVY_PHONE_PRETTY = "(480) 764-2121";
export const IVY_PHONE_HREF = `tel:${IVY_PHONE_E164}`;

/** Ivy's Retell agent — TBJ's OWN receptionist line. Env-overridable; falls back to the live id. */
export const IVY_AGENT_ID = process.env.IVY_AGENT_ID || "agent_fc091c7bd9f23c9760ed6fa559";
