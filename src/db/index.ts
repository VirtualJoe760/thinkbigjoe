import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema";

// Lean data layer: Drizzle over Neon (HTTP driver — serverless-friendly,
// one-shot queries). Replaces Payload's data access. Tables are the same
// ones Payload created (introspected into ./schema.ts), so data is preserved.
const connectionString =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL_UNPOOLED ||
  // Placeholder keeps neon() from throwing at build time (no env vars locally).
  // Real queries fail at runtime if DATABASE_URL is genuinely missing.
  "postgresql://placeholder:placeholder@placeholder.neon.tech/neondb";

const sql = neon(connectionString);
export const db = drizzle(sql, { schema });

export * from "./schema";
