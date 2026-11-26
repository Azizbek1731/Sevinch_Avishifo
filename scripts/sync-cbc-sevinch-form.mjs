/**
 * Sync CBC (Umumiy qon tahlili) with Sevinch "РАЗВЁРНУТЫЙ АНАЛИЗ КРОВИ" form:
 * 3-diff analyzer indices (LYM/MID/GRA # and %), P-LCR, clotting time, ESR.
 *
 * Updates lab-catalog.json, LabCatalogParameter, and clinic LabTest CBC rows.
 *
 *   node scripts/sync-cbc-sevinch-form.mjs
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'apps/api/prisma/seed-data/lab-catalog.json');
const NS = 'f7a1d0c2-9b3e-4a56-8d21-6c4b0e9f7a13';

function uuidv5(name) {
  const nsBytes = Buffer.from(NS.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(Buffer.concat([nsBytes, Buffer.from(name, 'utf8')])).digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const adult = (low, high, note = null) => ({
  gender: null,
  ageMinDays: null,
  ageMaxDays: null,
  state: null,
  low,
  high,
  criticalLow: null,
  criticalHigh: null,
  textNorm: null,
  label: 'Kattalar (analizator / Sevinch blank)',
  note,
});

const NEW_PARAMS = [
  {
    code: 'LYM_ABS',
    nameRu: 'Лимфоциты (абс.)',
    nameEn: 'Lymphocytes absolute (LYM#)',
    nameUz: 'Limfotsitlar (abs., LYM#)',
    unit: '10^9/L',
    valueType: 'NUMERIC',
    note: '3-diff analizator: LYM#. Sevinch blankasi: 0,8–4×10⁹/л',
    ranges: [adult(0.8, 4.0)],
  },
  {
    code: 'MID_ABS',
    nameRu: 'Клетки средних размеров (абс.)',
    nameEn: 'Mid cells absolute (MID#)',
    nameUz: 'O‘rtacha o‘lchamli hujayralar (abs., MID#)',
    unit: '10^9/L',
    valueType: 'NUMERIC',
    note: '3-diff analizator: MID# (mono/eo/baso guruhi). Sevinch: 0,1–1,5×10⁹/л',
    ranges: [adult(0.1, 1.5)],
  },
  {
    code: 'GRA_ABS',
    nameRu: 'Гранулоциты (абс.)',
    nameEn: 'Granulocytes absolute (GRA#)',
    nameUz: 'Granulotsitlar (abs., GRA#)',
    unit: '10^9/L',
    valueType: 'NUMERIC',
    note: '3-diff analizator: GRA#. Sevinch: 2,0–7,0×10⁹/л',
    ranges: [adult(2.0, 7.0)],
  },
  {
    code: 'LYM_PCT',
    nameRu: 'Процент лимфоцитов',
    nameEn: 'Lymphocytes percent (LYM%)',
    nameUz: 'Limfotsitlar foizi (LYM%)',
    unit: '%',
    valueType: 'NUMERIC',
    note: 'Sevinch blankasi 0,20–0,40 (ulush) — bu yerda foiz: 20–40%',
    ranges: [adult(20, 40)],
  },
  {
    code: 'MID_PCT',
    nameRu: 'Процент клеток средних размеров',
    nameEn: 'Mid cells percent (MID%)',
    nameUz: 'O‘rtacha o‘lchamli hujayralar foizi (MID%)',
    unit: '%',
    valueType: 'NUMERIC',
    note: 'Sevinch: 0,030–0,150 → 3–15%',
    ranges: [adult(3, 15)],
  },
  {
    code: 'GRA_PCT',
    nameRu: 'Процент гранулоцитов',
    nameEn: 'Granulocytes percent (GRA%)',
    nameUz: 'Granulotsitlar foizi (GRA%)',
    unit: '%',
    valueType: 'NUMERIC',
    note: 'Sevinch: 0,50–0,70 → 50–70%',
    ranges: [adult(50, 70)],
  },
  {
    code: 'P_LCR',
    nameRu: 'Доля крупных тромбоцитов',
    nameEn: 'Platelet Large Cell Ratio (P-LCR)',
    nameUz: 'Yirik trombotsitlar ulushi (P-LCR)',
    unit: '%',
    valueType: 'NUMERIC',
    note: 'Sevinch: 0,110–0,450 → 11–45%',
    ranges: [adult(11, 45)],
  },
  {
    code: 'CLOTTING_TIME',
    nameRu: 'Время свёртываемости крови',
    nameEn: 'Blood clotting time',
    nameUz: 'Qonning ivish vaqti',
    unit: 'min',
    valueType: 'TEXT',
    note: 'Sevinch blankasi: norma 3–5 мин (masalan 2:10 – 3:58)',
    ranges: [
      {
        gender: null,
        ageMinDays: null,
        ageMaxDays: null,
        state: null,
        low: null,
        high: null,
        criticalLow: null,
        criticalHigh: null,
        textNorm: '3–5 мин',
        label: 'Kattalar',
        note: null,
      },
    ],
  },
  {
    code: 'ESR',
    nameRu: 'Скорость оседания эритроцитов (СОЭ)',
    nameEn: 'Erythrocyte Sedimentation Rate (ESR)',
    nameUz: 'Eritrotsitlarning cho‘kish tezligi (SOE)',
    unit: 'mm/h',
    valueType: 'NUMERIC',
    note: 'Sevinch blankasi: М 1–10; Ж 2–15 мм/ч',
    ranges: [
      {
        gender: 'MALE',
        ageMinDays: null,
        ageMaxDays: null,
        state: null,
        low: 1,
        high: 10,
        criticalLow: null,
        criticalHigh: null,
        textNorm: null,
        label: 'Erkaklar',
        note: null,
      },
      {
        gender: 'FEMALE',
        ageMinDays: null,
        ageMaxDays: null,
        state: null,
        low: 2,
        high: 15,
        criticalLow: null,
        criticalHigh: null,
        textNorm: null,
        label: 'Ayollar',
        note: null,
      },
    ],
  },
];

/** Preferred print order matching Sevinch blank. */
const ORDER = [
  'WBC',
  'LYM_ABS',
  'MID_ABS',
  'GRA_ABS',
  'LYM_PCT',
  'MID_PCT',
  'GRA_PCT',
  'RBC',
  'HGB',
  'HCT',
  'MCV',
  'MCH',
  'MCHC',
  'RDW_CV',
  'RDW_SD',
  'PLT',
  'MPV',
  'PDW',
  'PCT',
  'P_LCR',
  'CLOTTING_TIME',
  'ESR',
];

function cleanRanges(ranges) {
  return ranges.map((r) => {
    const out = {};
    for (const [k, v] of Object.entries(r)) {
      if (v === null || v === undefined) continue;
      out[k] = v;
    }
    return out;
  });
}

function loadEnv() {
  const text = readFileSync(join(ROOT, '.env'), 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    const k = t.slice(0, i);
    let v = t.slice(i + 1);
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}

async function main() {
  loadEnv();
  const data = JSON.parse(readFileSync(SRC, 'utf8'));
  const cbc = data.tests.find((t) => t.code === 'CBC');
  if (!cbc) throw new Error('CBC missing in catalog JSON');

  cbc.nameRu = 'Общий анализ крови (развёрнутый)';
  cbc.nameUz = "Umumiy qon tahlili (kengaytirilgan)";
  cbc.nameEn = 'Complete Blood Count (extended)';
  cbc.specimenNote =
    'Цельная кровь с антикоагулянтом ЭДТА (K2/K3-EDTA). 3-diff analizator blankasi (Sevinch).';

  const byCode = new Map(cbc.parameters.map((p) => [p.code, p]));
  for (const p of NEW_PARAMS) {
    byCode.set(p.code, {
      code: p.code,
      nameRu: p.nameRu,
      nameEn: p.nameEn,
      nameUz: p.nameUz,
      unit: p.unit,
      valueType: p.valueType,
      note: p.note,
      ranges: p.ranges,
    });
  }
  cbc.parameters = ORDER.filter((c) => byCode.has(c)).map((c) => byCode.get(c));
  // Keep any unexpected extras at the end.
  for (const [code, p] of byCode) {
    if (!ORDER.includes(code)) cbc.parameters.push(p);
  }

  writeFileSync(SRC, `${JSON.stringify(data, null, 1)}\n`, 'utf8');
  console.log(`JSON CBC parameters: ${cbc.parameters.length}`);

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL missing');
  const client = new pg.Client({ connectionString: url });
  await client.connect();

  const catalogTestId = uuidv5('test:CBC');
  await client.query(
    `UPDATE "LabCatalogTest"
     SET "nameUz" = $1, "nameRu" = $2, "nameEn" = $3, "specimenNote" = $4
     WHERE code = 'CBC'`,
    [cbc.nameUz, cbc.nameRu, cbc.nameEn, cbc.specimenNote],
  );

  for (const [idx, p] of cbc.parameters.entries()) {
    const id = uuidv5(`param:CBC:${p.code}`);
    const ranges = JSON.stringify(cleanRanges(p.ranges ?? []));
    await client.query(
      `INSERT INTO "LabCatalogParameter"
        ("id","testId","code","nameUz","nameRu","nameEn","unit","valueType","note","referenceRanges","sortOrder")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::"LabValueType",$9,$10::jsonb,$11)
       ON CONFLICT ("testId","code") DO UPDATE SET
         "nameUz" = EXCLUDED."nameUz",
         "nameRu" = EXCLUDED."nameRu",
         "nameEn" = EXCLUDED."nameEn",
         "unit" = EXCLUDED."unit",
         "valueType" = EXCLUDED."valueType",
         "note" = EXCLUDED."note",
         "referenceRanges" = EXCLUDED."referenceRanges",
         "sortOrder" = EXCLUDED."sortOrder"`,
      [
        id,
        catalogTestId,
        p.code,
        p.nameUz,
        p.nameRu,
        p.nameEn ?? null,
        p.unit ?? null,
        p.valueType ?? 'NUMERIC',
        p.note ?? null,
        ranges,
        idx,
      ],
    );
  }

  const clinicTests = await client.query(
    `SELECT id, "clinicId" FROM "LabTest" WHERE code = 'CBC' OR "catalogCode" = 'CBC'`,
  );
  for (const row of clinicTests.rows) {
    await client.query(
      `UPDATE "LabTest"
       SET name = $1::jsonb,
           "specimenType" = 'blood',
           biomaterial = 'BLOOD',
           category = 'HEMATOLOGY',
           "catalogCode" = 'CBC'
       WHERE id = $2`,
      [JSON.stringify({ uz: cbc.nameUz, ru: cbc.nameRu, en: cbc.nameEn }), row.id],
    );

    for (const [idx, p] of cbc.parameters.entries()) {
      const ranges = JSON.stringify(cleanRanges(p.ranges ?? []));
      const existing = await client.query(
        `SELECT id FROM "LabTestParameter"
         WHERE "labTestId" = $1 AND (code = $2 OR name = $3)
         LIMIT 1`,
        [row.id, p.code, p.nameUz],
      );
      if (existing.rows[0]) {
        await client.query(
          `UPDATE "LabTestParameter"
           SET name = $1, code = $2, unit = $3, "valueType" = $4::"LabValueType",
               "referenceRanges" = $5::jsonb, "sortOrder" = $6
           WHERE id = $7`,
          [
            p.nameUz,
            p.code,
            p.unit ?? null,
            p.valueType ?? 'NUMERIC',
            ranges,
            idx,
            existing.rows[0].id,
          ],
        );
      } else {
        await client.query(
          `INSERT INTO "LabTestParameter"
            ("id","clinicId","labTestId","name","code","unit","valueType","referenceRanges","sortOrder")
           VALUES ($1,$2,$3,$4,$5,$6,$7::"LabValueType",$8::jsonb,$9)`,
          [
            randomUUID(),
            row.clinicId,
            row.id,
            p.nameUz,
            p.code,
            p.unit ?? null,
            p.valueType ?? 'NUMERIC',
            ranges,
            idx,
          ],
        );
      }
    }
    console.log(`Clinic LabTest ${row.id}: synced ${cbc.parameters.length} parameters`);
  }

  await client.end();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
