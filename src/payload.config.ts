import path from "path";
import { fileURLToPath } from "url";

import { postgresAdapter } from "@payloadcms/db-postgres";
import { lexicalEditor } from "@payloadcms/richtext-lexical";
import { buildConfig } from "payload";

import { Users } from "./collections/Users";
import { Media } from "./collections/Media";
import { Pages } from "./collections/Pages";

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
    meta: {
      titleSuffix: "· ThinkBigJoe",
    },
  },
  collections: [Users, Media, Pages],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || "",
  typescript: {
    outputFile: path.resolve(dirname, "payload-types.ts"),
  },
  db: postgresAdapter({
    pool: {
      // Vercel's Neon integration injects DATABASE_URL (pooled). Fall back to
      // other common names / the local .env override.
      connectionString:
        process.env.DATABASE_URL ||
        process.env.POSTGRES_URL ||
        process.env.DATABASE_URI ||
        "",
    },
  }),
  // NOTE: `sharp` is intentionally omitted. It's only needed for image
  // resizing (we define no imageSizes yet), and its native libvips binary
  // fails to load in Vercel's serverless runtime under Next 16 Turbopack +
  // pnpm file tracing. Re-add it once that's solved if/when image sizes are
  // configured on the Media collection.
});
