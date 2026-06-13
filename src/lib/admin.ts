/**
 * Admin allowlist for the internal Command Center (/command). Phase-1 gate is a
 * simple email allowlist; expand ADMIN_EMAILS (comma-separated env) or swap to a
 * role field later. Used by the /command route guard.
 */
const DEFAULT_ADMINS = ["josephsardella@gmail.com"];

function allowlist(): string[] {
  const fromEnv = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return fromEnv.length > 0 ? fromEnv : DEFAULT_ADMINS;
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return allowlist().includes(email.trim().toLowerCase());
}
