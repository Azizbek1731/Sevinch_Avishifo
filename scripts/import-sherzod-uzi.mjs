/**
 * Imports Sherzod UZI EXO price list and tags existing UZI catalogue for Bekchanova.
 * Usage: node --env-file=.env scripts/import-sherzod-uzi.mjs [path-to-xlsx]
 */
import ExcelJS from 'exceljs';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const xlsxPath =
  process.env.SHERZOD_UZI_XLSX ||
  process.argv[2] ||
  resolve(process.env.USERPROFILE || 'C:\\Users\\Администратор.WIN-JVBSUPIPLDH', 'Desktop', "Ma'lumotlar Avishifo uchun.xlsx");

const SHERZOD_CATEGORY = 'UZI EXO — Abdullayev Sherzod';
const BEKCHANOVA_CATEGORY = 'UZI (UTT) — Bekchanova Mohira';
const LEGACY_CATEGORY = 'UZI (UTT) diagnostika';

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const rel of ['.env', '../.env']) {
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
  const ws = wb.worksheets[0];
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const name = cellText(row.getCell(1).value);
    const priceRaw = row.getCell(2).value;
    if (!name || priceRaw == null || priceRaw === '') return;
    rows.push({
      index: rows.length + 1,
      nameUz: name,
      price: money(priceRaw),
    });
  });
  return rows;
}

async function ensureCategory(prisma, clinicId, name, kind, sortOrder) {
  const existing = await prisma.serviceCategory.findFirst({ where: { clinicId, name, kind } });
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

const prisma = new PrismaClient({ datasources: { db: { url: loadDatabaseUrl() } } });

async function main() {
  const clinic = await prisma.clinic.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!clinic) throw new Error('Clinic topilmadi');

  const legacy = await prisma.serviceCategory.findFirst({
    where: { clinicId: clinic.id, kind: 'ULTRASOUND', name: LEGACY_CATEGORY },
  });
  if (legacy) {
    await prisma.serviceCategory.update({
      where: { id: legacy.id },
      data: { name: BEKCHANOVA_CATEGORY },
    });
    console.log('renamed', LEGACY_CATEGORY, '→', BEKCHANOVA_CATEGORY);
  } else {
    await ensureCategory(prisma, clinic.id, BEKCHANOVA_CATEGORY, 'ULTRASOUND', 31);
  }

  const sherzodCat = await ensureCategory(prisma, clinic.id, SHERZOD_CATEGORY, 'ULTRASOUND', 32);
  const rows = await readRows(xlsxPath);
  if (rows.length === 0) throw new Error(`Bo‘sh fayl: ${xlsxPath}`);
  console.log('importing', rows.length, 'services into', SHERZOD_CATEGORY);

  const now = new Date();
  for (const row of rows) {
    const code = `UZI-EXO-${String(row.index).padStart(2, '0')}`;
    const name = { uz: row.nameUz };
    const existing = await prisma.service.findFirst({
      where: { clinicId: clinic.id, code },
    });
    let serviceId;
    if (existing) {
      await prisma.service.update({
        where: { id: existing.id },
        data: {
          categoryId: sherzodCat.id,
          name,
          isActive: true,
          durationMin: 20,
          unit: 'tekshiruv',
        },
      });
      serviceId = existing.id;
      console.log('updated', code, row.nameUz, row.price);
    } else {
      const created = await prisma.service.create({
        data: {
          clinicId: clinic.id,
          categoryId: sherzodCat.id,
          code,
          name,
          durationMin: 20,
          unit: 'tekshiruv',
          vatIncluded: true,
          isActive: true,
        },
      });
      serviceId = created.id;
      console.log('created', code, row.nameUz, row.price);
    }

    const openPrice = await prisma.servicePrice.findFirst({
      where: { serviceId, branchId: null, effectiveTo: null },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (openPrice && openPrice.price.toFixed(2) === row.price) continue;
    if (openPrice) {
      await prisma.servicePrice.update({
        where: { id: openPrice.id },
        data: { effectiveTo: now },
      });
    }
    await prisma.servicePrice.create({
      data: {
        clinicId: clinic.id,
        serviceId,
        branchId: null,
        price: row.price,
        effectiveFrom: now,
      },
    });
  }

  const sherzod = await prisma.user.findFirst({
    where: { role: 'DOCTOR', fullName: { contains: 'Sherzod', mode: 'insensitive' } },
    select: { id: true, fullName: true, staffProfile: { select: { specialty: true } } },
  });
  const bekchanova = await prisma.user.findFirst({
    where: { role: 'DOCTOR', fullName: { contains: 'Bekchanova', mode: 'insensitive' } },
    select: { id: true, fullName: true, staffProfile: { select: { specialty: true } } },
  });
  console.log('doctors', { sherzod, bekchanova });
  console.log('done');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
