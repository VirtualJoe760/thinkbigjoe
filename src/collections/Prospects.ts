import type { CollectionConfig } from "payload";

/**
 * Outbound prospects surfaced by the LinkedIn prospecting routine (recon →
 * score → draft). Distinct from `leads` (inbound, from the funnel). Feeds the
 * admin-only Command Center review queue. Created server-side only (ingest
 * script / future scheduled job via the Local API) — no public create.
 */
export const Prospects: CollectionConfig = {
  slug: "prospects",
  admin: {
    useAsTitle: "name",
    defaultColumns: ["name", "company", "vertical", "fitScore", "status"],
    group: "Prospecting",
  },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: () => false,
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  fields: [
    { name: "name", type: "text", required: true },
    { name: "title", type: "text" },
    { name: "company", type: "text" },
    {
      name: "vertical",
      type: "select",
      options: [
        { label: "Insurance", value: "insurance" },
        { label: "Mortgage", value: "mortgage" },
        { label: "Wealth / Advisory", value: "wealth" },
        { label: "MSP / IT", value: "msp" },
        { label: "Law firm", value: "law" },
        { label: "Other", value: "other" },
      ],
      admin: { position: "sidebar" },
    },
    { name: "location", type: "text" },
    {
      name: "degree",
      type: "text",
      admin: { description: "Connection degree, e.g. 2nd. Warmth signal." },
    },
    { name: "mutuals", type: "text", admin: { description: "Shared connections, if any." } },
    { name: "niche", type: "text" },
    {
      name: "hook",
      type: "textarea",
      admin: { description: "Personalization hooks pulled from recon." },
    },
    { name: "profileUrl", type: "text", admin: { description: "Sales Nav / LinkedIn profile URL." } },
    {
      name: "fitScore",
      type: "number",
      admin: { position: "sidebar", description: "0–6 from the fit rubric." },
    },
    { name: "fitReason", type: "textarea" },
    {
      name: "status",
      type: "select",
      defaultValue: "qualified",
      options: [
        { label: "New", value: "new" },
        { label: "Qualified", value: "qualified" },
        { label: "Note ready", value: "note_ready" },
        { label: "Connected", value: "connected" },
        { label: "Diagnostic sent", value: "diagnostic_sent" },
        { label: "Replied", value: "replied" },
        { label: "Invited", value: "invited" },
        { label: "Prepped", value: "prepped" },
        { label: "Meeting", value: "meeting" },
        { label: "Won", value: "won" },
        { label: "Lost", value: "lost" },
        { label: "Disqualified", value: "disqualified" },
      ],
      admin: { position: "sidebar" },
    },
    {
      name: "source",
      type: "text",
      admin: { position: "sidebar", description: "Which search / file the prospect came from." },
    },
    {
      name: "recon",
      type: "json",
      admin: { description: "Raw recon record (optional)." },
    },
  ],
};
