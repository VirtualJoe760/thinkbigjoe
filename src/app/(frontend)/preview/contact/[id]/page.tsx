import Link from "next/link";
import { notFound } from "next/navigation";
import { getContact } from "../../_lib/data";
import { Avatar, Card, OwnerTag, TempPill } from "../../_components/ui";

const LIFE: Record<string, string> = {
  prospect: "bg-surface text-ink-soft",
  lead: "bg-brand-tint text-brand",
  client: "bg-emerald-50 text-emerald-600",
  past_client: "bg-surface text-ink-soft",
};

function InfoRow({ icon, label, accent = false }: { icon: string; label: string; accent?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-ink-soft" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
        <path d={icon} />
      </svg>
      <span className={`truncate ${accent ? "text-brand" : ""}`}>{label}</span>
    </div>
  );
}

function ChannelTag({ channel, prefix = "" }: { channel: "linkedin" | "email"; prefix?: string }) {
  const li = channel === "linkedin";
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${li ? "bg-sky-50 text-sky-600" : "bg-slate-100 text-slate-600"}`}>
      <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        {li ? <path d="M6 9v8M6 6v.01M10 17v-5a2 2 0 014 0v5M4 4h16v16H4z" /> : <path d="M4 5h16v14H4zM4 7l8 6 8-6" />}
      </svg>
      {prefix}{li ? "LinkedIn" : "Email"}
    </span>
  );
}

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = getContact(id);
  if (!c) notFound();

  const isClient = c.lifecycle === "client";
  const convAgent = isClient ? "Relationship" : "Communication";
  const channels = Array.from(new Set((c.conversation ?? []).map((m) => m.channel)));

  return (
    <>
      <Link href="/preview/contacts" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}><path d="M15 18l-6-6 6-6" /></svg>
        Contacts
      </Link>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3.5">
          <Avatar name={c.name} size={52} />
          <div>
            <h1 className="text-xl font-bold tracking-tight">{c.name}</h1>
            <p className="text-sm text-ink-soft">{c.title} · {c.company}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TempPill t={c.temperature} />
          <span className={`rounded-md px-2.5 py-0.5 text-xs font-semibold capitalize ${LIFE[c.lifecycle]}`}>{c.lifecycle.replace("_", " ")}</span>
          <span className="rounded-md bg-surface px-2.5 py-0.5 text-xs text-ink-soft">{c.vertical} · {c.location}</span>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Main */}
        <div className="flex flex-col gap-5 lg:col-span-2">
          <Card>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                <svg viewBox="0 0 24 24" className="h-4 w-4 text-ink-soft" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" /></svg>
                What we know
              </h2>
              <span className="text-[11px] text-ink-soft/70">updated by {c.owner} · 2h ago</span>
            </div>
            <p className="text-sm leading-relaxed">{c.digest}</p>
          </Card>

          {c.facts && (
            <Card>
              <h2 className="mb-3 text-sm font-semibold">Facts</h2>
              <div className="flex flex-wrap gap-2">
                {c.facts.map((f) => (
                  <span key={f} className="rounded-md bg-surface px-2.5 py-1 text-xs">{f}</span>
                ))}
              </div>
            </Card>
          )}

          <Card className="p-0">
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 className="text-sm font-semibold">Conversation</h2>
              <div className="flex items-center gap-1.5">
                {channels.length ? channels.map((ch) => <ChannelTag key={ch} channel={ch} />) : <span className="text-[11px] text-ink-soft">no messages yet</span>}
              </div>
            </div>

            {c.conversation?.length ? (
              <div className="flex flex-col gap-3 bg-surface/40 px-5 py-4">
                {c.conversation.map((m, i) => (
                  <div key={i} className={`flex ${m.from === "them" ? "justify-start" : "justify-end"}`}>
                    <div className="max-w-[80%]">
                      <div className={`rounded-2xl px-3.5 py-2 text-sm ${m.from === "them" ? "rounded-tl-sm border border-line bg-background" : "rounded-tr-sm bg-brand text-white"}`}>
                        <p className="leading-snug">{m.text}</p>
                      </div>
                      <div className={`mt-1 flex items-center gap-1.5 text-[10px] text-ink-soft ${m.from === "them" ? "" : "flex-row-reverse"}`}>
                        <ChannelTag channel={m.channel} />
                        <span>{m.from === "them" ? c.name.split(" ")[0] : `${m.agent} agent`} · {m.when}</span>
                        {m.intent && <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-600">{m.intent}</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="px-5 pt-4 text-sm text-ink-soft">No messages yet — the {convAgent} agent will open the first touch.</p>
            )}

            {c.suggestedReply && (
              <div className="border-t border-line p-4">
                <div className="rounded-xl border border-brand/20 bg-brand-tint/40 p-3.5">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-brand">
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round"><path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" /></svg>
                      Suggested reply · {convAgent} agent
                    </span>
                    <ChannelTag channel={c.suggestedReply.channel} prefix="via " />
                  </div>
                  <p className="text-sm leading-snug">{c.suggestedReply.text}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-dark">Approve &amp; send</button>
                    <button className="rounded-lg border border-line bg-background px-3 py-1.5 text-xs font-medium hover:bg-surface">Edit</button>
                    <button className="rounded-lg border border-line bg-background px-3 py-1.5 text-xs font-medium hover:bg-surface">Regenerate</button>
                  </div>
                </div>

                <div className="mt-3">
                  <label className="mb-1.5 block text-[11px] font-medium text-ink-soft">Direct the {convAgent} agent</label>
                  <div className="flex items-center gap-2 rounded-xl border border-line px-3 py-2">
                    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-ink-soft" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M9 2h6M5 8h14v11H5zM9 13h.01M15 13h.01M12 2v3" /></svg>
                    <input placeholder="e.g. offer the Thursday slot and mention the renewal automation…" className="flex-1 bg-transparent text-sm outline-none placeholder:text-ink-soft/70" />
                    <button className="shrink-0 rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-white hover:bg-ink/90">Send to agent</button>
                  </div>
                </div>
              </div>
            )}
          </Card>
        </div>

        {/* Rail */}
        <div className="flex flex-col gap-5">
          <Card>
            <h2 className="mb-3 text-sm font-semibold">Contact info</h2>
            <dl className="flex flex-col gap-2.5 text-sm">
              <InfoRow icon="M4 5h16v14H4zM4 7l8 6 8-6" label={c.email} />
              <InfoRow icon="M4 4h4l2 5-2 1a11 11 0 005 5l1-2 5 2v4a2 2 0 01-2 2A16 16 0 014 6a2 2 0 012-2z" label={c.phone} />
              <InfoRow icon="M12 21s7-6 7-11a7 7 0 10-14 0c0 5 7 11 7 11zM12 10a1 1 0 100-2 1 1 0 000 2z" label={c.address} />
              <InfoRow icon="M9 21V8h6m-9 0h12M4 5h16M5 8v13h14V8" label={`${c.company} · ${c.vertical}`} />
              {c.website && <InfoRow icon="M3 12a9 9 0 1018 0 9 9 0 10-18 0M3 12h18M12 3c3 3 3 15 0 18-3-3-3-15 0-18z" label={c.website} accent />}
              {c.linkedin && <InfoRow icon="M6 9v8M6 6v.01M10 17v-5a2 2 0 014 0v5M4 4h16v16H4z" label={c.linkedin} accent />}
            </dl>
          </Card>

          <div className="rounded-2xl border border-brand/20 bg-brand-tint/50 p-5">
            <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-brand">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}><path d="M5 3l14 9-14 9z" /></svg>
              Next best action
            </h2>
            <p className="text-sm leading-snug">{c.nextAction}</p>
            {c.followup && (
              <div className="mt-3 flex items-center justify-between border-t border-brand/15 pt-3 text-xs text-ink-soft">
                <span>Follow-up {c.followup.n} of {c.followup.total} · next in {c.followup.nextInDays}d</span>
                <span className="inline-flex items-center gap-1 font-medium text-emerald-600">
                  <span className="relative inline-block h-3.5 w-6 rounded-full bg-emerald-500"><span className="absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full bg-white" /></span>
                  Auto
                </span>
              </div>
            )}
          </div>

          {c.ideas && (
            <Card>
              <h2 className="mb-2.5 flex items-center gap-1.5 text-sm font-semibold">
                <svg viewBox="0 0 24 24" className="h-4 w-4 text-ink-soft" fill="none" stroke="currentColor" strokeWidth={2}><path d="M9 18h6M10 22h4M12 2a6 6 0 00-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0012 2z" /></svg>
                Ideas for their business
              </h2>
              <ul className="flex flex-col gap-1.5 text-sm">
                {c.ideas.map((idea) => (
                  <li key={idea} className="flex gap-2"><span className="text-brand">•</span>{idea}</li>
                ))}
              </ul>
            </Card>
          )}

          {isClient ? (
            <Card>
              <h2 className="mb-3 text-sm font-semibold">Client</h2>
              <dl className="flex flex-col gap-2 text-sm">
                <div className="flex justify-between"><dt className="text-ink-soft">Since</dt><dd className="font-medium">{c.clientSince}</dd></div>
                <div className="flex justify-between"><dt className="text-ink-soft">Plan</dt><dd className="font-medium">{c.plan}</dd></div>
                <div className="flex justify-between"><dt className="text-ink-soft">Last check-in</dt><dd className="font-medium">{c.lastCheckInDays}d ago</dd></div>
                <div className="flex justify-between"><dt className="text-ink-soft">Next check-in</dt><dd className="font-medium">{c.nextCheckInDays === 0 ? "due now" : `in ${c.nextCheckInDays}d`}</dd></div>
              </dl>
              <p className="mt-3 flex items-center gap-1.5 border-t border-line pt-3 text-xs text-ink-soft">
                <OwnerTag owner="Relationship agent" /> handles check-ins
              </p>
            </Card>
          ) : (
            <Card>
              <div className="mb-3 flex items-center justify-between text-sm">
                <span className="text-ink-soft">Deal stage</span>
                <span className="font-medium">{c.dealStage}</span>
              </div>
              <button className="w-full rounded-lg bg-ink py-2 text-sm font-medium text-white transition-colors hover:bg-ink/90">
                Convert to client
              </button>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
