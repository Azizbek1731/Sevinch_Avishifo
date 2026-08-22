#!/usr/bin/env node
/**
 * Regenerate the standard laboratory catalogue seed from its JSON source.
 *
 *   node scripts/gen-lab-catalog-sql.mjs
 *
 * Reads apps/api/prisma/seed-data/lab-catalog.json and rewrites the INSERT block of the
 * lab_catalog migration. The catalogue ships as a migration rather than through seed.ts
 * because production deploys run `prisma migrate deploy` and never run the seed — a
 * dictionary that only exists in the seed would simply be absent from every real clinic.
 *
 * Row ids are UUIDv5 of the catalogue code under a fixed namespace, so regenerating this
 * file produces byte-identical SQL and a re-import maps onto the same rows.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'apps/api/prisma/seed-data/lab-catalog.json');
const MIGRATION = join(
  ROOT,
  'apps/api/prisma/migrations/20260822002440_lab_catalog/migration.sql',
);
const MARKER = '-- ==== standard laboratory catalogue (generated; see scripts/gen-lab-catalog-sql.mjs)';

/** Fixed namespace for catalogue ids — never change it, or every id moves. */
const NS = 'f7a1d0c2-9b3e-4a56-8d21-6c4b0e9f7a13';

function uuidv5(name) {
  const nsBytes = Buffer.from(NS.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(Buffer.concat([nsBytes, Buffer.from(name, 'utf8')])).digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50; // version 5
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const q = (v) =>
  v === null || v === undefined || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;

/** Drop nulls so a stored interval carries only the qualifiers the source actually gave. */
function cleanRange(r) {
  const out = {};
  for (const [k, v] of Object.entries(r)) {
    if (v === null || v === undefined) continue;
    if (k === 'sourceLines') continue;
    out[k] = v;
  }
  return out;
}

const data = JSON.parse(readFileSync(SRC, 'utf8'));
const lines = [MARKER];
let testOrder = 0;
let paramCount = 0;
let rangeCount = 0;

for (const t of data.tests) {
  const testId = uuidv5(`test:${t.code}`);
  lines.push(
    `INSERT INTO "LabCatalogTest" ("id","code","biomaterial","category","nameUz","nameRu","nameEn","specimenNote","sortOrder") VALUES ` +
      `(${q(testId)},${q(t.code)},${q(t.biomaterial)}::"Biomaterial",${q(t.category)}::"LabCategory",` +
      `${q(t.nameUz)},${q(t.nameRu)},${q(t.nameEn)},${q(t.specimenNote)},${testOrder}) ` +
      `ON CONFLICT ("code") DO NOTHING;`,
  );
  testOrder += 1;

  (t.parameters ?? []).forEach((p, idx) => {
    const ranges = (p.ranges ?? []).map(cleanRange);
    rangeCount += ranges.length;
    paramCount += 1;
    lines.push(
      `INSERT INTO "LabCatalogParameter" ("id","testId","code","nameUz","nameRu","nameEn","unit","valueType","note","referenceRanges","sortOrder") VALUES ` +
        `(${q(uuidv5(`param:${t.code}:${p.code}`))},${q(testId)},${q(p.code)},${q(p.nameUz)},${q(p.nameRu)},` +
        `${q(p.nameEn)},${q(p.unit)},${q(p.valueType ?? 'NUMERIC')}::"LabValueType",${q(p.note)},` +
        `${q(JSON.stringify(ranges))}::jsonb,${idx}) ON CONFLICT ("testId","code") DO NOTHING;`,
    );
  });
}

const sql = readFileSync(MIGRATION, 'utf8');
const head = sql.includes(MARKER) ? sql.slice(0, sql.indexOf(MARKER)) : `${sql.trimEnd()}\n\n`;
writeFileSync(MIGRATION, `${head}${lines.join('\n')}\n`, 'utf8');

console.log(
  `catalogue: ${data.tests.length} tests, ${paramCount} parameters, ${rangeCount} reference intervals`,
);
