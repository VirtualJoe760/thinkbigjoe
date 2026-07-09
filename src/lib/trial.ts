// The 7-day trial model. After a site is built, the owner can play with it — edit
// content, use Studio, preview — for a grace period. When the trial ends unpaid, the
// EDIT features lock (the site/preview stays viewable, never deleted). Subscribing
// unlocks editing AND takes the site live. Computed from builtAt + oneTimePaid, so no
// schema column is needed.

export const TRIAL_DAYS = 7;

export type TrialState = "paid" | "building" | "trial" | "trial_ended";

export type TrialInfo = {
  state: TrialState;
  /** Can the owner use Studio / edit / go-live-adjacent tools right now? */
  canEdit: boolean;
  /** Whole days left in the trial (only meaningful when state === "trial"). */
  daysLeft: number;
  trialEndsAt: string | null;
};

export function trialStatus(site: {
  oneTimePaid?: boolean | null;
  builtAt?: string | null;
}): TrialInfo {
  if (site.oneTimePaid) return { state: "paid", canEdit: true, daysLeft: 0, trialEndsAt: null };
  if (!site.builtAt) return { state: "building", canEdit: false, daysLeft: 0, trialEndsAt: null };

  const endsMs = new Date(site.builtAt).getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000;
  const trialEndsAt = new Date(endsMs).toISOString();
  if (Date.now() < endsMs) {
    const daysLeft = Math.max(1, Math.ceil((endsMs - Date.now()) / (24 * 60 * 60 * 1000)));
    return { state: "trial", canEdit: true, daysLeft, trialEndsAt };
  }
  return { state: "trial_ended", canEdit: false, daysLeft: 0, trialEndsAt };
}
