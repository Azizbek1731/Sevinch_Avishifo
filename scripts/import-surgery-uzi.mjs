/**
 * Imports jarrohlik operatsiyalari + UZI preyskurant from CRM Excel into Service catalog.
 * Usage: node scripts/import-surgery-uzi.mjs [path-to-xlsx]
 */
import ExcelJS from 'exceljs';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const xlsxPath =
  process.argv[2] ||
  resolve(
    process.env.USERPROFILE || 'C:\\Users',
    'Администратор.WIN-JVBSUPIPLDH',
    'Downloads',
    'operatsiya_va_uzi_preyskurant_crm.xlsx',
  );

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const rel of ['.env', '../.env', '../../.env']) {
    try {
      const text = readFileSync(resolve(process.cwd(), rel), 'utf8');
      const match = text.match(/^DATABASE_URL=(.*)$/m);
      if (match) return match[1].trim().replace(/^['"]|['"]$/g, '');
    } catch {
      /* next */
    }
  }
  throw new Error('DATABASE_URL topilmadi');
}

function cellText(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (typeof value === 'object') {
    if ('text' in value) return String(value.text ?? '').trim();
    if ('result' in value) return cellText(value.result);
    if ('richText' in value) return value.richText.map((p) => p.text).join('').trim();
  }
  return String(value).trim();
}

function money(value) {
  const n = Number(String(value).replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) throw new Error(`Noto‘g‘ri narx: ${value}`);
  return n.toFixed(2);
}

async function readRows(path) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.getWorksheet('CRM_Import_3_Tilda') || wb.worksheets[0];
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    // Col 3 = Kod (OPR-*/UZI-*); col 2 is bo'lim T/r
    const code = cellText(row.getCell(3).value);
    if (!code || /^jami/i.test(code)) return;
    const kind = /^UZI-/i.test(code) ? 'ULTRASOUND' : 'SURGERY';
    rows.push({
      code,
      kind,
      categoryUz: cellText(row.getCell(4).value),
      categoryRu: cellText(row.getCell(5).value),
      nameUz: cellText(row.getCell(7).value),
      nameRu: cellText(row.getCell(8).value),
      unit: cellText(row.getCell(10).value) || (kind === 'ULTRASOUND' ? 'tekshiruv' : 'operatsiya'),
      durationMin: kind === 'ULTRASOUND' ? 20 : 60,
      price: money(row.getCell(14).value),
    });
  });
  return rows;
}

const prisma = new PrismaClient({ datasources: { db: { url: loadDatabaseUrl() } } });

async function ensureCategory(clinicId, name, kind, sortOrder) {
  const existing = await prisma.serviceCategory.findFirst({
    where: { clinicId, name, kind },
  });
  if (existing) {
    if (!existing.isActive) {
      return prisma.serviceCategory.update({
        where: { id: existing.id },
        data: { isActive: true, sortOrder },
      });
    }
    return existing;
  }
  return prisma.serviceCategory.create({
    data: { clinicId, name, kind, sortOrder, isActive: true },
  });
}

async function upsertService(clinicId, categoryId, row) {
  const name = { uz: row.nameUz, ru: row.nameRu || undefined };
  const existing = await prisma.service.findFirst({
    where: { clinicId, code: row.code },
  });
  const now = new Date();
  if (existing) {
    await prisma.service.update({
      where: { id: existing.id },
      data: {
        categoryId,
        name,
        unit: row.unit.slice(0, 30),
        durationMin: row.durationMin,
        isActive: true,
      },
    });
    const current = await prisma.servicePrice.findFirst({
      where: {
        clinicId,
        serviceId: existing.id,
        branchId: null,
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!current || current.price.toFixed(2) !== row.price) {
      if (current && current.effectiveTo == null) {
        await prisma.servicePrice.update({
          where: { id: current.id },
          data: { effectiveTo: now },
        });
      }
      await prisma.servicePrice.create({
        data: {
          clinicId,
          serviceId: existing.id,
          branchId: null,
          price: row.price,
          effectiveFrom: now,
        },
      });
      return { code: row.code, action: 'updated+price' };
    }
    return { code: row.code, action: 'updated' };
  }

  await prisma.service.create({
    data: {
      clinicId,
      categoryId,
      code: row.code,
      name,
      unit: row.unit.slice(0, 30),
      durationMin: row.durationMin,
      vatIncluded: true,
      isActive: true,
      prices: {
        create: {
          clinicId,
          branchId: null,
          price: row.price,
          effectiveFrom: now,
        },
      },
    },
  });
  return { code: row.code, action: 'created' };
}

async function main() {
  console.log('file', xlsxPath);
  const rows = await readRows(xlsxPath);
  console.log('rows', rows.length, {
    opr: rows.filter((r) => r.kind === 'SURGERY').length,
    uzi: rows.filter((r) => r.kind === 'ULTRASOUND').length,
  });

  const clinic = await prisma.clinic.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!clinic) throw new Error('Klinika topilmadi');
  console.log('clinic', clinic.name);

  const surgery = await ensureCategory(clinic.id, 'Jarrohlik operatsiyalari', 'SURGERY', 30);
  const uzi = await ensureCategory(clinic.id, 'UZI (UTT) diagnostika', 'ULTRASOUND', 31);
  console.log('categories', surgery.id, uzi.id);

  const results = [];
  for (const row of rows) {
    const categoryId = row.kind === 'ULTRASOUND' ? uzi.id : surgery.id;
    results.push(await upsertService(clinic.id, categoryId, row));
  }

  const created = results.filter((r) => r.action === 'created').length;
  const updated = results.filter((r) => r.action.startsWith('updated')).length;
  console.log(
    JSON.stringify(
      {
        created,
        updated,
        total: results.length,
        opr: results.filter((r) => r.code.startsWith('OPR-')).length,
        uzi: results.filter((r) => r.code.startsWith('UZI-')).length,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
