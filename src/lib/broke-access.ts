/**
 * Broke access gate. "broke" (broke.finance) is a gated extension of thinkbigjoe, sold as
 * a membership. Phase-1 gate = email allowlist (BROKE_EMAILS, comma-separated). Swap to the
 * broke.memberships table (shared Neon DB, `broke` schema) once billing is wired. Mirrors
 * the admin allowlist pattern in admin.ts.
 */
const DEFAULT_BROKE = ["josephsardella@gmail.com"];

function allowlist(): string[] {
  const fromEnv = (process.env.BROKE_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return fromEnv.length > 0 ? fromEnv : DEFAULT_BROKE;
}

export function hasBrokeAccess(email: string | null | undefined): boolean {
  if (!email) return false;
  return allowlist().includes(email.trim().toLowerCase());
}
