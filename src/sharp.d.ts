// `sharp` ships its own types, but they don't resolve under TS's
// "bundler" moduleResolution (its package.json "exports" omits the type
// condition for the ESM entry). It's only used as an opaque value passed to
// Payload's config, so an ambient declaration is sufficient and avoids the
// `next build` type error: "Could not find a declaration file for module 'sharp'".
declare module "sharp";
