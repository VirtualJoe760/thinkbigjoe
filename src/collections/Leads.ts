import type { CollectionConfig } from "payload";

/**
 * Sales leads captured by the acquisition funnel: industry landing-page
 * intakes, the homepage contact form, and (after booking) strategy calls.
 * Created server-side only (route handlers via the Local API) — there is no
 * public create access; the admin panel is the mini-CRM view.
 */
export const Leads: CollectionConfig = {
  slug: "leads",
  admin: {
    useAsTitle: "name",
    defaultColumns: ["name", "company", "industry", "status", "createdAt"],
    group: "Sales",
  },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: () => false, // server-side only (overrideAccess)
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  fields: [
    { name: "name", type: "text", required: true },
    { name: "email", type: "email", required: true, index: true },
    { name: "phone", type: "text" },
    { name: "company", type: "text" },
    { name: "role", type: "text" },
    {
      name: "industry",
      type: "text",
      admin: { description: "Industry slug or free text from the intake." },
    },
    {
      name: "teamSize",
      type: "select",
      options: [
        { label: "Just me", value: "1" },
        { label: "2–10", value: "2-10" },
        { label: "11–50", value: "11-50" },
        { label: "51–200", value: "51-200" },
        { label: "200+", value: "200+" },
      ],
    },
    {
      name: "timeline",
      type: "select",
      options: [
        { label: "ASAP", value: "asap" },
        { label: "This quarter", value: "quarter" },
        { label: "This year", value: "year" },
        { label: "Just exploring", value: "exploring" },
      ],
    },
    { name: "problem", type: "textarea", label: "What they want to build" },
    {
      name: "emailType",
      type: "select",
      options: [
        { label: "Business", value: "business" },
        { label: "Free provider", value: "free" },
      ],
      admin: {
        position: "sidebar",
        description: "Business-domain emails are usually stronger leads.",
      },
    },
    {
      name: "source",
      type: "select",
      required: true,
      options: [
        { label: "Industry page", value: "industry-page" },
        { label: "Booking page", value: "booking-page" },
        { label: "Contact form", value: "contact-form" },
      ],
      admin: { position: "sidebar" },
    },
    {
      name: "sourcePath",
      type: "text",
      admin: {
        position: "sidebar",
        description: "Page the lead came from, e.g. /for/law-firms",
      },
    },
    {
      name: "status",
      type: "select",
      defaultValue: "new",
      options: [
        { label: "New", value: "new" },
        { label: "Call booked", value: "booked" },
        { label: "Contacted", value: "contacted" },
        { label: "Qualified", value: "qualified" },
        { label: "Won", value: "won" },
        { label: "Lost", value: "lost" },
      ],
      admin: { position: "sidebar" },
    },
    {
      name: "bookedSlot",
      type: "text",
      admin: {
        position: "sidebar",
        description: "ISO start time of the booked strategy call, if any.",
      },
    },
    { name: "notes", type: "textarea" },
  ],
};
