// Mock data for the Command Center v2 UI preview. No DB — purely illustrative
// so the new CRM flow can be reviewed without touching live data.

export type Stage = "new" | "connected" | "in_conversation" | "meeting" | "won";
export type Temp = "cold" | "warm" | "hot";
export type Lifecycle = "prospect" | "lead" | "client" | "past_client";
export type Channel = "linkedin" | "email";

export type Msg = {
  channel: Channel;
  from: "them" | "agent";
  agent?: string;
  text: string;
  when: string;
  intent?: string;
};

export type Contact = {
  id: string;
  name: string;
  title: string;
  company: string;
  vertical: string;
  location: string;
  email: string;
  phone: string;
  address: string;
  website?: string;
  linkedin?: string;
  stage: Stage;
  temperature: Temp;
  lifecycle: Lifecycle;
  owner: string;
  fit: number;
  digest?: string;
  facts?: string[];
  ideas?: string[];
  nextAction?: string;
  followup?: { n: number; total: number; nextInDays: number; enabled: boolean };
  conversation?: Msg[];
  suggestedReply?: { channel: Channel; text: string };
  dealStage?: string;
  // client-only
  clientSince?: string;
  plan?: string;
  lastCheckInDays?: number;
  nextCheckInDays?: number;
  health?: "good" | "watch" | "risk";
};

export const STAGE_LABEL: Record<Stage, string> = {
  new: "New",
  connected: "Connected",
  in_conversation: "In conversation",
  meeting: "Meeting",
  won: "Won",
};

export const BOARD_STAGES: Stage[] = ["new", "connected", "in_conversation", "meeting"];

export const CONTACTS: Contact[] = [
  {
    id: "liam",
    name: "Liam Park",
    title: "Owner",
    company: "Park Creek Financial Group",
    vertical: "Insurance",
    location: "Phoenix, AZ",
    email: "liam@parkcreekfg.com",
    phone: "(602) 555-0148",
    address: "2100 E Camelback Rd, Phoenix, AZ 85016",
    website: "parkcreekfg.com",
    linkedin: "in/liam-park",
    stage: "in_conversation",
    temperature: "hot",
    lifecycle: "lead",
    owner: "Communication",
    fit: 6,
    digest:
      "Liam has run Park Creek, a 14-person independent insurance agency, since 2019 (ex-broker). He's openly curious about AI but skeptical it pays off at his size — his real pain is the manual admin around policy renewals and client follow-up. Relationship-first operator: warm to peer conversation, slow on email, fastest on LinkedIn in the evenings.",
    facts: [
      "14 staff · 3 offices",
      "Owner since 2019 · ex-broker",
      "AI-curious, cost-wary",
      "Pain: renewal admin + follow-up",
      "Best on LinkedIn, evenings",
      "Coaches his son's hockey team",
    ],
    ideas: [
      "Auto-draft renewal reminders from their AMS",
      "AI intake for new-policy quotes",
      "Weekly book-of-business digest",
    ],
    nextAction: "He's warm — propose 3 call slots and reference his renewal pain.",
    followup: { n: 3, total: 10, nextInDays: 5, enabled: true },
    dealStage: "Diagnostic → invite",
    conversation: [
      {
        channel: "linkedin",
        from: "agent",
        agent: "Communication",
        text: "Connected and opened with a question about how renewals land on his team.",
        when: "6d ago",
      },
      {
        channel: "linkedin",
        from: "them",
        text: "Honestly, renewals eat my team alive every quarter. What are you seeing work?",
        when: "5d ago",
        intent: "interested",
      },
      {
        channel: "email",
        from: "agent",
        agent: "Communication",
        text: "Shared a 2-step renewal-automation idea and offered a short walkthrough.",
        when: "2h ago",
      },
    ],
    suggestedReply: {
      channel: "linkedin",
      text: "Love it — want me to grab 20 min to show you a rough renewal-automation build (not a deck)? I've got Tue 4pm, Wed 11am, or Thu 2pm.",
    },
  },
  {
    id: "sara",
    name: "Sara Kim",
    title: "Managing Partner",
    company: "Kim Law",
    vertical: "Law",
    location: "Austin, TX",
    email: "sara@kimlaw.co",
    phone: "(512) 555-0193",
    address: "600 Congress Ave, Austin, TX 78701",
    website: "kimlaw.co",
    linkedin: "in/sara-kim",
    stage: "in_conversation",
    temperature: "hot",
    lifecycle: "lead",
    owner: "Communication",
    fit: 5,
    digest:
      "Sara runs a 9-attorney boutique firm focused on small-business clients. Sharp, time-poor, replies in bursts late at night. Interested in AI for intake and document drafting but worried about confidentiality.",
    facts: ["9 attorneys", "Small-business focus", "Concern: confidentiality", "Replies late nights"],
    ideas: ["AI intake triage", "Engagement-letter drafting", "Matter status digests"],
    nextAction: "Address confidentiality head-on, then offer a walkthrough.",
    followup: { n: 2, total: 10, nextInDays: 3, enabled: true },
    dealStage: "Diagnostic",
    conversation: [
      { channel: "linkedin", from: "agent", agent: "Communication", text: "Opened on intake load for boutique firms.", when: "8d ago" },
      { channel: "linkedin", from: "them", text: "Intake is a mess but I can't risk client confidentiality.", when: "7d ago", intent: "objection" },
    ],
    suggestedReply: {
      channel: "linkedin",
      text: "Totally fair — everything runs in your environment and nothing trains on client data. Want a quick walkthrough so you can see exactly how it's isolated?",
    },
  },
  {
    id: "priya",
    name: "Priya Nair",
    title: "Principal",
    company: "Nair Wealth",
    vertical: "Wealth",
    location: "Denver, CO",
    email: "priya@nairwealth.com",
    phone: "(303) 555-0112",
    address: "1700 Lincoln St, Denver, CO 80203",
    website: "nairwealth.com",
    linkedin: "in/priya-nair",
    stage: "connected",
    temperature: "warm",
    lifecycle: "prospect",
    owner: "Communication",
    fit: 5,
    digest:
      "Priya is a solo RIA building a practice. Accepted the connection, engaged lightly. Curious about AI for client comms but cautious on compliance.",
    facts: ["Solo RIA", "Compliance-cautious", "Building practice"],
    ideas: ["Compliant client-update drafts", "Meeting-prep briefs"],
    nextAction: "Ask one diagnostic question about her biggest weekly time sink.",
    followup: { n: 1, total: 10, nextInDays: 2, enabled: true },
    dealStage: "Connected",
    conversation: [
      { channel: "linkedin", from: "agent", agent: "Communication", text: "Thanked her for connecting, light peer note.", when: "3d ago" },
    ],
    suggestedReply: {
      channel: "linkedin",
      text: "Quick one — what eats the most of your week right now: client comms, meeting prep, or compliance paperwork?",
    },
  },
  {
    id: "tom",
    name: "Tom Vance",
    title: "Owner",
    company: "Vance MSP",
    vertical: "MSP",
    location: "Tampa, FL",
    email: "tom@vancemsp.com",
    phone: "(813) 555-0177",
    address: "400 N Tampa St, Tampa, FL 33602",
    website: "vancemsp.com",
    linkedin: "in/tom-vance",
    stage: "connected",
    temperature: "warm",
    lifecycle: "prospect",
    owner: "Communication",
    fit: 4,
    digest: "Tom owns a 12-person managed-IT shop. Pragmatic, busy. Open to AI if it saves ticket time.",
    facts: ["12 staff", "Ticket-volume pain", "Pragmatic buyer"],
    ideas: ["AI ticket triage", "Auto-drafted client updates"],
    nextAction: "Lead with a ticket-deflection angle.",
    followup: { n: 1, total: 10, nextInDays: 4, enabled: true },
    dealStage: "Connected",
    suggestedReply: {
      channel: "linkedin",
      text: "Curious how your team handles ticket triage today — mostly manual, or do you have something routing them? Always trading notes with MSP owners on it.",
    },
  },
  {
    id: "dana",
    name: "Dana Reyes",
    title: "Agency Owner",
    company: "Reyes Insurance",
    vertical: "Insurance",
    location: "Mesa, AZ",
    email: "dana@reyesinsurance.com",
    phone: "(480) 555-0166",
    address: "1234 S Power Rd, Mesa, AZ 85206",
    website: "reyesinsurance.com",
    linkedin: "in/dana-reyes",
    stage: "new",
    temperature: "cold",
    lifecycle: "prospect",
    owner: "Research",
    fit: 5,
    digest: "Researched: independent agency, ~8 staff. Strong fit on renewal-admin pain. Not yet contacted.",
    facts: ["~8 staff", "Independent agency", "Not contacted"],
    ideas: ["Renewal reminder automation", "Quote-intake assistant"],
    nextAction: "Queue a connection request with a renewal hook.",
    dealStage: "New",
    suggestedReply: {
      channel: "linkedin",
      text: "Hi Dana — fellow small-business builder, working with a few independent agencies on cutting renewal admin. Would love to connect and trade notes.",
    },
  },
  {
    id: "marcus",
    name: "Marcus Hale",
    title: "Founder",
    company: "Hale & Co",
    vertical: "Insurance",
    location: "Scottsdale, AZ",
    email: "marcus@haleandco.com",
    phone: "(480) 555-0121",
    address: "7000 E 1st Ave, Scottsdale, AZ 85251",
    website: "haleandco.com",
    linkedin: "in/marcus-hale",
    stage: "new",
    temperature: "cold",
    lifecycle: "prospect",
    owner: "Research",
    fit: 4,
    digest: "Researched: commercial-lines agency. Decision-maker confirmed. Awaiting first touch.",
    facts: ["Commercial lines", "Decision-maker", "Awaiting touch"],
    ideas: ["Submission intake automation", "Renewal digest"],
    nextAction: "Queue first touch.",
    dealStage: "New",
    suggestedReply: {
      channel: "linkedin",
      text: "Hi Marcus — I work with commercial-lines agencies on automating submission intake. Would be glad to connect and compare notes on what's actually working.",
    },
  },
  {
    id: "erik",
    name: "Erik Solis",
    title: "Broker / Owner",
    company: "Solis Mortgage",
    vertical: "Mortgage",
    location: "Gilbert, AZ",
    email: "erik@solismortgage.com",
    phone: "(480) 555-0139",
    address: "1500 N Gilbert Rd, Gilbert, AZ 85234",
    website: "solismortgage.com",
    linkedin: "in/erik-solis",
    stage: "meeting",
    temperature: "hot",
    lifecycle: "lead",
    owner: "Meeting strategist",
    fit: 6,
    digest:
      "Erik booked a 30-min walkthrough for Thursday. Runs a 6-person brokerage, drowning in document chasing during underwriting. Ready to see a build, not a deck.",
    facts: ["6-person brokerage", "Pain: doc chasing", "Call booked Thu 2pm"],
    ideas: ["Borrower doc-collection agent", "Status updates to realtors", "Conditions tracker"],
    nextAction: "Meeting strategist has prepped your brief — review before Thursday.",
    dealStage: "Meeting booked",
    conversation: [
      { channel: "email", from: "agent", agent: "Communication", text: "Sent 3 slots; he took Thursday 2pm.", when: "2d ago" },
      { channel: "email", from: "them", text: "Thursday works. Curious what this looks like for a small shop.", when: "2d ago", intent: "interested" },
    ],
    suggestedReply: {
      channel: "email",
      text: "Looking forward to Thursday. I'll come with a rough build of the borrower doc-collection flow tailored to a 6-person shop — nothing generic.",
    },
  },
  {
    id: "nadia",
    name: "Nadia Brooks",
    title: "Owner",
    company: "Brooks Insurance Group",
    vertical: "Insurance",
    location: "Chandler, AZ",
    email: "nadia@brooksinsgroup.com",
    phone: "(480) 555-0155",
    address: "2200 W Chandler Blvd, Chandler, AZ 85224",
    website: "brooksinsgroup.com",
    linkedin: "in/nadia-brooks",
    stage: "won",
    temperature: "warm",
    lifecycle: "client",
    owner: "Relationship",
    fit: 6,
    digest: "Closed 3 months ago. Running renewal-reminder + intake automations. Happy; mentioned a second location opening.",
    facts: ["Client since Mar", "2 automations live", "Expanding — 2nd location"],
    conversation: [
      { channel: "email", from: "agent", agent: "Relationship", text: "Monthly check-in — shared her renewal-automation time savings.", when: "12d ago" },
      { channel: "email", from: "them", text: "Thanks! It's saved us hours. Also — we're opening a second location.", when: "12d ago", intent: "positive" },
    ],
    suggestedReply: {
      channel: "email",
      text: "Congrats on location #2! Want me to set up the renewal + intake automations for the new office too, so it's running from day one?",
    },
    nextAction: "Relationship agent: congratulate on the new location, check satisfaction.",
    clientSince: "Mar 2026",
    plan: "Automation retainer",
    lastCheckInDays: 12,
    nextCheckInDays: 6,
    health: "good",
  },
  {
    id: "raj",
    name: "Raj Patel",
    title: "Owner",
    company: "Patel Advisory",
    vertical: "Wealth",
    location: "Irvine, CA",
    email: "raj@pateladvisory.com",
    phone: "(949) 555-0184",
    address: "18200 Von Karman Ave, Irvine, CA 92612",
    website: "pateladvisory.com",
    linkedin: "in/raj-patel",
    stage: "won",
    temperature: "cold",
    lifecycle: "client",
    owner: "Relationship",
    fit: 5,
    digest: "Closed 6 weeks ago. Quieter lately — last two check-ins unanswered. Watch for churn.",
    facts: ["Client since May", "1 automation live", "Two check-ins unanswered"],
    conversation: [
      { channel: "linkedin", from: "agent", agent: "Relationship", text: "Check-in + a quick-win idea for his reporting.", when: "21d ago" },
      { channel: "linkedin", from: "agent", agent: "Relationship", text: "Light nudge — no pressure, just making sure things are running ok.", when: "9d ago" },
    ],
    suggestedReply: {
      channel: "linkedin",
      text: "Hey Raj — no agenda, just checking in. Would a 15-min tune-up on your current automation be useful? Happy to add a quick win while I'm in there.",
    },
    nextAction: "Relationship agent flagged: re-engage, offer a quick win.",
    clientSince: "May 2026",
    plan: "Starter",
    lastCheckInDays: 21,
    nextCheckInDays: 0,
    health: "risk",
  },
];

export function getContact(id: string): Contact | undefined {
  return CONTACTS.find((c) => c.id === id);
}

export const CLIENTS = CONTACTS.filter((c) => c.lifecycle === "client");

export const LIFECYCLE_TABS: { key: Lifecycle | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "prospect", label: "Prospects" },
  { key: "lead", label: "Leads" },
  { key: "client", label: "Clients" },
];

export type CalEvent = {
  id: string;
  contactId: string;
  date: string; // YYYY-MM-DD
  dayLabel: string;
  time: string;
  title: string;
  kind: "walkthrough" | "check-in" | "intro";
  hasBrief?: boolean;
};

export const EVENTS: CalEvent[] = [
  { id: "e1", contactId: "erik", date: "2026-06-25", dayLabel: "Thu, Jun 25", time: "2:00 PM", title: "Walkthrough — Solis Mortgage", kind: "walkthrough", hasBrief: true },
  { id: "e2", contactId: "nadia", date: "2026-06-26", dayLabel: "Fri, Jun 26", time: "11:00 AM", title: "Client check-in — Brooks Insurance", kind: "check-in" },
  { id: "e3", contactId: "sara", date: "2026-06-29", dayLabel: "Mon, Jun 29", time: "10:30 AM", title: "Intro call — Kim Law", kind: "intro", hasBrief: true },
];

export type Agent = {
  id: string;
  name: string;
  role: string;
  status: "running" | "paused" | "off";
  autonomy: "draft" | "assisted" | "autonomous";
  today: string;
  cohort: string;
  lastRun: string;
};

export const AGENTS: Agent[] = [
  { id: "research", name: "Research", role: "Find · enrich · ideas", status: "running", autonomy: "autonomous", today: "9 / 15 researched", cohort: "Insurance", lastRun: "12m ago" },
  { id: "communication", name: "Communication", role: "Connect · nurture · book", status: "running", autonomy: "autonomous", today: "5 / 8 sent", cohort: "Insurance · 20 contacts", lastRun: "4m ago" },
  { id: "meeting", name: "Meeting strategist", role: "Preps Joey to close", status: "running", autonomy: "autonomous", today: "1 brief", cohort: "All booked", lastRun: "2h ago" },
  { id: "relationship", name: "Relationship", role: "Warm network + client check-ins", status: "off", autonomy: "draft", today: "—", cohort: "Phase 3", lastRun: "—" },
  { id: "social", name: "Social", role: "IG + LinkedIn posts", status: "off", autonomy: "draft", today: "—", cohort: "Phase 3", lastRun: "—" },
  { id: "ads", name: "Meta ads", role: "Retarget by audience", status: "off", autonomy: "draft", today: "—", cohort: "Phase 4", lastRun: "—" },
];

export const ACTIVITY = [
  { agent: "Communication", text: "Emailed Liam Park a renewal-automation idea", when: "2h ago" },
  { agent: "Research", text: "Added Dana Reyes (Reyes Insurance) — fit 5", when: "3h ago" },
  { agent: "Meeting strategist", text: "Prepped brief for Erik Solis (Thu 2pm)", when: "2h ago" },
  { agent: "Communication", text: "Sara Kim replied — flagged objection: confidentiality", when: "7h ago" },
  { agent: "Research", text: "Enriched 6 prospects with email + phone", when: "Today, 2:01am" },
];
