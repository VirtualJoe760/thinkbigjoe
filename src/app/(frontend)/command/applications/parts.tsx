import { jobApplications } from "@/db";

// Shared presentational pieces for the Whitney board + the full-job detail page.
export type Job = typeof jobApplications.$inferSelect;
export type Review = { source?: string; rating?: number; count?: number; url?: string; summary?: string };
export type Contact = { recruiter_name?: string; email?: string; phone?: string; careers_url?: string; linkedin?: string };

export const STAGE: Record<string, { label: string; cls: string }> = {
  found: { label: "Needs review", cls: "bg-amber-50 text-amber-700" },
  approved: { label: "Approved · queued", cls: "bg-blue-50 text-blue-700" },
  account_created: { label: "Account created", cls: "bg-indigo-50 text-indigo-700" },
  verified: { label: "Verified", cls: "bg-indigo-50 text-indigo-700" },
  applied: { label: "Applied", cls: "bg-green-50 text-green-700" },
  interview: { label: "Interview", cls: "bg-green-100 text-green-800" },
  dismissed: { label: "Dismissed", cls: "bg-surface text-ink-soft" },
  rejected: { label: "Rejected", cls: "bg-surface text-ink-soft" },
  closed: { label: "Closed", cls: "bg-surface text-ink-soft" },
};

export function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function abbreviate(text: string | null, max = 160): string {
  if (!text) return "";
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max).trimEnd()}…` : clean;
}

export function asJson<T>(v: unknown): T | null {
  if (v == null) return null;
  if (typeof v === "string") {
    try { return JSON.parse(v) as T; } catch { return null; }
  }
  return v as T;
}

export function StageBadge({ status }: { status: string }) {
  const s = STAGE[status] ?? { label: status, cls: "bg-surface text-ink-soft" };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${s.cls}`}>
      {s.label}
    </span>
  );
}

export function ScoreChip({ label, score }: { label: string; score: number | null }) {
  if (score == null) return null;
  const cls = score >= 75 ? "bg-green-50 text-green-700" : score >= 50 ? "bg-amber-50 text-amber-700" : "bg-surface text-ink-soft";
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{label} {score}%</span>;
}

export function MetaRow({ job }: { job: Job }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-soft">
      {job.location && <span>{job.location}</span>}
      {job.pay && <span>· {job.pay}</span>}
      {job.platform && <span>· {job.platform}</span>}
      {job.url && (
        <a href={job.url} target="_blank" rel="noreferrer" className="text-brand hover:underline">· posting ↗</a>
      )}
      {job.companyWebsite && (
        <a href={job.companyWebsite} target="_blank" rel="noreferrer" className="text-brand hover:underline">· company site ↗</a>
      )}
    </div>
  );
}

function Stars({ rating }: { rating?: number }) {
  if (rating == null) return null;
  return <span className="font-semibold text-ink">★ {rating.toFixed(1)}</span>;
}

/** Full detail block — job description, company, sourced reviews, contact. Used on the detail page. */
export function JobDetails({ job }: { job: Job }) {
  const reviews = asJson<Review[]>(job.companyReviews) ?? [];
  const contact = asJson<Contact>(job.contactInfo);
  const hasCompany = job.companyAbout || job.companyAddress || job.companyWebsite;
  const hasContact = contact && Object.values(contact).some(Boolean);

  return (
    <div className="space-y-5">
      {job.jobDescription && (
        <section>
          <p className="text-[11px] font-bold uppercase tracking-wide text-ink-soft">Job description</p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink">{job.jobDescription}</p>
        </section>
      )}

      {hasCompany && (
        <section>
          <p className="text-[11px] font-bold uppercase tracking-wide text-ink-soft">Company</p>
          {job.companyAbout && <p className="mt-1 text-sm leading-relaxed text-ink">{job.companyAbout}</p>}
          <div className="mt-1 space-y-0.5 text-xs text-ink-soft">
            {job.companyAddress && <p>📍 {job.companyAddress}</p>}
            {job.companyWebsite && (
              <p>🔗 <a href={job.companyWebsite} target="_blank" rel="noreferrer" className="text-brand hover:underline">{job.companyWebsite}</a></p>
            )}
          </div>
        </section>
      )}

      {reviews.length > 0 && (
        <section>
          <p className="text-[11px] font-bold uppercase tracking-wide text-ink-soft">Reviews</p>
          <div className="mt-1 space-y-1.5">
            {reviews.map((rv, i) => (
              <div key={i} className="rounded-lg bg-surface px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-ink">{rv.source ?? "Review"}</span>
                  <Stars rating={rv.rating} />
                  {rv.count != null && <span className="text-[11px] text-ink-soft">({rv.count} reviews)</span>}
                  {rv.url && <a href={rv.url} target="_blank" rel="noreferrer" className="text-brand hover:underline">source ↗</a>}
                </div>
                {rv.summary && <p className="mt-1 leading-relaxed text-ink-soft">{rv.summary}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {hasContact && contact && (
        <section>
          <p className="text-[11px] font-bold uppercase tracking-wide text-ink-soft">Contact</p>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-soft">
            {contact.recruiter_name && <span>{contact.recruiter_name}</span>}
            {contact.email && <a href={`mailto:${contact.email}`} className="text-brand hover:underline">{contact.email}</a>}
            {contact.phone && <span>{contact.phone}</span>}
            {contact.careers_url && <a href={contact.careers_url} target="_blank" rel="noreferrer" className="text-brand hover:underline">careers ↗</a>}
            {contact.linkedin && <a href={contact.linkedin} target="_blank" rel="noreferrer" className="text-brand hover:underline">LinkedIn ↗</a>}
          </div>
        </section>
      )}
    </div>
  );
}
