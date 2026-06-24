// Loads ../.env.local into process.env (only keys not already set), so both the
// runner and browserbase.mjs read the same config. Import for side effect: `import "./env.mjs"`.
import { readFileSync } from "node:fs";

try {
  const txt = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*"?([^"\n\r]*)"?\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch {
  // no .env.local — rely on real process env (e.g. CI secrets)
}
