import type { CollectionConfig } from "payload";

/**
 * Staff / admin users who manage the CMS and client work.
 * Client-portal accounts will live in a separate `Clients` collection
 * so the two audiences can have distinct access rules and fields.
 */
export const Users: CollectionConfig = {
  slug: "users",
  admin: {
    useAsTitle: "email",
    group: "Team",
  },
  auth: true,
  fields: [
    {
      name: "name",
      type: "text",
    },
  ],
};
