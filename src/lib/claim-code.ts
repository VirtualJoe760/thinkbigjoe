import { randomInt } from "node:crypto";

// Unambiguous alphabet — no 0/O/1/I/L so codes are easy to read aloud and type.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/**
 * A human-friendly claim code, e.g. "TBJ-K4MP-7XQ2". Handed to the business
 * owner after their site is built; they redeem it in the portal to attach the
 * site to their account. Collisions are astronomically unlikely, but the
 * caller stores it against a UNIQUE column and can retry on the rare clash.
 */
export function generateClaimCode(): string {
  const block = () =>
    Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `TBJ-${block()}-${block()}`;
}

/** Normalize user input for lookup: uppercase, trim, collapse spaces. */
export function normalizeClaimCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}
