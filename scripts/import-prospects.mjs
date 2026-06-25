/**
 * import-prospects.mjs
 * Imports all 5 prospecting CSVs into the Neon Postgres DB.
 *
 * Usage: node scripts/import-prospects.mjs
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { parse } from 'csv-parse/sync';
import pg from 'pg';

// ---------------------------------------------------------------------------
// Load .env.local (dotenv-style manual parse — avoids needing the dotenv pkg)
// ---------------------------------------------------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../env.local');

try {
  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    // strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
} catch (err) {
  console.error('Could not read env.local:', err.message);
  process.exit(1);
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not found in env.local');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// CSV file definitions
// ---------------------------------------------------------------------------
const PROSPECTING_DIR = resolve(__dirname, '../prospecting');

const CSV_FILES = [
  {
    file: 'finance-insurance-prospects.csv',
    // columns: name, title, company, subvertical, location, degree, warmth, fit, angle, profile_url, status
    hasSubvertical: true,
    hasProfileUrl: true,
    hasSalesnavUrl: false,
    hasWarmth: true,
    hasNotes: false,
  },
  {
    file: 'finance-insurance-salesnav-qualified.csv',
    // columns: name, title, company, subvertical, location, fit, angle, salesnav_url, status
    hasSubvertical: true,
    hasProfileUrl: false,
    hasSalesnavUrl: true,
    hasWarmth: false,
    hasNotes: false,
  },
  {
    file: 'law-firms-salesnav.csv',
    // columns: name, title, company, location, fit, angle, salesnav_url, status
    hasSubvertical: false,
    hasProfileUrl: false,
    hasSalesnavUrl: true,
    hasWarmth: false,
    hasNotes: false,
    defaultVertical: 'law',
  },
  {
    file: 'msps-it-salesnav.csv',
    // columns: name, title, company, location, fit, angle, salesnav_url, status, notes
    hasSubvertical: false,
    hasProfileUrl: false,
    hasSalesnavUrl: true,
    hasWarmth: false,
    hasNotes: true,
    defaultVertical: 'msp',
  },
  {
    file: 'wealth-salesnav.csv',
    // columns: name, title, company, location, fit, angle, salesnav_url, status, notes
    hasSubvertical: false,
    hasProfileUrl: false,
    hasSalesnavUrl: true,
    hasWarmth: false,
    hasNotes: true,
    defaultVertical: 'wealth',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function mapFitScore(fit) {
  const f = (fit || '').trim().toLowerCase();
  if (f === 'high') return 8;
  if (f === 'medium') return 5;
  if (f === 'low') return 3;
  return null;
}

function mapVertical(subvertical, defaultVertical) {
  if (defaultVertical) return defaultVertical;
  const sv = (subvertical || '').trim().toLowerCase();
  if (sv.includes('insurance')) return 'insurance';
  if (sv.includes('wealth') || sv.includes('advisory') || sv.includes('invest')) return 'wealth';
  if (sv.includes('law') || sv.includes('legal')) return 'law';
  if (sv.includes('msp') || sv.includes('it')) return 'msp';
  if (sv.includes('mortgage')) return 'mortgage';
  return 'other';
}

function firstName(name) {
  return (name || '').trim().split(/\s+/)[0];
}

function generateConnectionNote(name, company, vertical) {
  const first = firstName(name);
  const verticalLabel = vertical || 'financial services';
  return `Hey ${first} — I came across your profile and was impressed by ${company || 'your work'}. I work with ${verticalLabel} firms on AI automation — would love to connect.`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const client = new pg.Client({ connectionString: DATABASE_URL });

async function run() {
  await client.connect();

  let totalInserted = 0;
  let totalSkipped = 0;

  for (const def of CSV_FILES) {
    const filePath = resolve(PROSPECTING_DIR, def.file);
    console.log(`\nProcessing: ${def.file}`);

    let rawCsv;
    try {
      rawCsv = readFileSync(filePath, 'utf8');
    } catch (err) {
      console.error(`  Could not read file: ${err.message}`);
      continue;
    }

    const rows = parse(rawCsv, {
      columns: true,       // first row = headers
      skip_empty_lines: true,
      trim: true,
    });

    let fileInserted = 0;
    let fileSkipped = 0;

    for (const row of rows) {
      // Resolve profile_url: use profile_url if present, else salesnav_url
      const profileUrl =
        (def.hasProfileUrl && row.profile_url && row.profile_url.trim())
          ? row.profile_url.trim()
          : (def.hasSalesnavUrl && row.salesnav_url && row.salesnav_url.trim())
            ? row.salesnav_url.trim()
            : null;

      // Dedup check: if we have a profile_url, skip if already in DB
      if (profileUrl) {
        const existing = await client.query(
          'SELECT id FROM prospects WHERE profile_url = $1 LIMIT 1',
          [profileUrl]
        );
        if (existing.rows.length > 0) {
          fileSkipped++;
          continue;
        }
      }

      const name = (row.name || '').trim();
      const title = (row.title || '').trim() || null;
      const company = (row.company || '').trim() || null;
      const location = (row.location || '').trim() || null;
      const degree = (row.degree || '').trim() || '2nd';
      const angle = (row.angle || '').trim() || null;
      const subvertical = def.hasSubvertical ? (row.subvertical || '').trim() : null;
      const warmth = def.hasWarmth ? (row.warmth || '').trim() || null : null;
      const notes = def.hasNotes ? (row.notes || '').trim() || null : null;

      const fitScore = mapFitScore(row.fit);
      const vertical = mapVertical(subvertical, def.defaultVertical);
      const niche = subvertical || null;

      // recon JSON
      const recon = {
        warmth: warmth,
        angle: angle,
        notes: notes,
      };

      // Insert prospect
      let prospectId;
      try {
        const result = await client.query(
          `INSERT INTO prospects
             (name, title, company, location, profile_url, fit_score, fit_reason,
              hook, niche, degree, vertical, status, source, recon, paused)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                   $11::enum_prospects_vertical,
                   'new'::enum_prospects_status,
                   $12, $13, $14)
           RETURNING id`,
          [
            name,
            title,
            company,
            location,
            profileUrl,
            fitScore,
            angle,       // fit_reason
            angle,       // hook
            niche,
            degree,
            vertical,
            'csv_import',
            JSON.stringify(recon),
            false,
          ]
        );
        prospectId = result.rows[0].id;
      } catch (err) {
        console.error(`  Error inserting prospect "${name}": ${err.message}`);
        fileSkipped++;
        continue;
      }

      // Insert outreach connection draft
      const connectionBody = generateConnectionNote(name, company, vertical);
      try {
        await client.query(
          `INSERT INTO outreach (prospect_id, step, status, body)
           VALUES ($1, 'connection'::enum_outreach_step, 'draft'::enum_outreach_status, $2)`,
          [prospectId, connectionBody]
        );
      } catch (err) {
        console.error(`  Error inserting outreach for prospect id ${prospectId}: ${err.message}`);
        // prospect was inserted — don't count as skipped
      }

      fileInserted++;
    }

    console.log(`  Inserted: ${fileInserted}  Skipped: ${fileSkipped}`);
    totalInserted += fileInserted;
    totalSkipped += fileSkipped;
  }

  await client.end();

  console.log('\n========================================');
  console.log(`TOTAL  Inserted: ${totalInserted}  Skipped: ${totalSkipped}`);
  console.log('========================================\n');
}

run().catch((err) => {
  console.error('Fatal error:', err);
  client.end();
  process.exit(1);
});
