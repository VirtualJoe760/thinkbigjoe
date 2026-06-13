import type { CollectionConfig } from "payload";

/**
 * Draft outreach messages tied to a prospect — one per step of the routine
 * (connection → diagnostic → reflect → invite → follow-up). Each sits in
 * `draft` until Joe approves/edits/denies in the Command Center. Sending stays
 * human-gated; `sent` is set when Joe actually sends. Created server-side only.
 */
export const Outreach: CollectionConfig = {
  slug: "outreach",
  admin: {
    useAsTitle: "step",
    defaultColumns: ["prospect", "step", "status"],
    group: "Prospecting",
  },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: () => false,
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  fields: [
    {
      name: "prospect",
      type: "relationship",
      relationTo: "prospects",
      required: true,
    },
    {
      name: "step",
      type: "select",
      required: true,
      defaultValue: "connection",
      options: [
        { label: "Connection request", value: "connection" },
        { label: "Diagnostic question", value: "diagnostic" },
        { label: "Reflect", value: "reflect" },
        { label: "Invite", value: "invite" },
        { label: "Follow-up", value: "followup" },
      ],
      admin: { position: "sidebar" },
    },
    {
      name: "body",
      type: "textarea",
      required: true,
      admin: { description: "The drafted message. Edit before approving if needed." },
    },
    {
      name: "status",
      type: "select",
      defaultValue: "draft",
      options: [
        { label: "Draft (awaiting review)", value: "draft" },
        { label: "Approved", value: "approved" },
        { label: "Edited", value: "edited" },
        { label: "Denied", value: "denied" },
        { label: "Sent", value: "sent" },
      ],
      admin: { position: "sidebar" },
    },
    {
      name: "denyReason",
      type: "textarea",
      admin: { description: "Why it was denied — feeds back into better drafts." },
    },
    { name: "approvedAt", type: "date", admin: { position: "sidebar" } },
    { name: "sentAt", type: "date", admin: { position: "sidebar" } },
  ],
};
