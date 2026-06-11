import type { CollectionConfig } from "payload";

/**
 * CMS-managed landing / marketing pages.
 * Starts intentionally simple (title + slug + rich content). The next
 * iteration turns `content` into a block-based builder (hero, services,
 * CTA, testimonial blocks) so pages — including AI-generated ones — can be
 * composed without code.
 */
export const Pages: CollectionConfig = {
  slug: "pages",
  admin: {
    useAsTitle: "title",
    defaultColumns: ["title", "slug", "status", "updatedAt"],
    group: "Content",
  },
  access: {
    read: () => true,
  },
  fields: [
    {
      name: "title",
      type: "text",
      required: true,
    },
    {
      name: "slug",
      type: "text",
      required: true,
      unique: true,
      index: true,
      admin: {
        description:
          "URL path for this page, e.g. 'ai-for-law-firms'. No leading slash.",
      },
    },
    {
      name: "status",
      type: "select",
      defaultValue: "draft",
      options: [
        { label: "Draft", value: "draft" },
        { label: "Published", value: "published" },
      ],
      admin: {
        position: "sidebar",
      },
    },
    {
      name: "content",
      type: "richText",
    },
    {
      name: "meta",
      type: "group",
      label: "SEO",
      fields: [
        { name: "title", type: "text" },
        { name: "description", type: "textarea" },
      ],
    },
  ],
};
