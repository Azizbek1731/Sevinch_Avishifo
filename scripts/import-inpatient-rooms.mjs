/**
 * Imports statsionar palatalar (2–4 etaj) from CRM Excel into InpatientRoom.
 * Usage: node scripts/import-inpatient-rooms.mjs [path-to-xlsx]
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
    'statsionar_palatalar_2_3_4_etaj_crm.xlsx',
  );

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const text = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
  const match = text.match(/^DATABASE_URL=(.*)$/m);
  if (!match) throw new Error('DATABASE_URL topilmadi');
  return match[1].trim().replace(/^['"]|['"]$/g, '');
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

/** Room number from CRM code (PAL-401-1 → 401-1) so /1 and /2 stay unique. */
function numberFromCode(code) {
  const match = /^PAL-(.+)$/i.exec(code);
  return match ? match[1] : code;
}

async function readRows(path) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.getWorksheet('CRM_Palatalar_3_Tilda') || wb.worksheets[0];
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const code = cellText(row.getCell(2).value);
    if (!code || /^jami/i.test(code)) return;
    const floor = Number(cellText(row.getCell(3).value));
    const nameUz = cellText(row.getCell(6).value);
    const tariffUz = cellText(row.getCell(9).value);
    const capacity = Number(cellText(row.getCell(15).value) || '1');
    if (!Number.isInteger(floor) || floor < 1) throw new Error(`Etaj noto‘g‘ri: ${code}`);
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error(`Sig‘im noto‘g‘ri: ${code}`);
    rows.push({
      code,
      floor,
      number: numberFromCode(code),
      name: tariffUz ? `${nameUz} — ${tariffUz}` : nameUz,
      capacity,
      pricePerDay: money(row.getCell(16).value),
    });
  });
  return rows;
}

const prisma = new PrismaClient({ datasources: { db: { url: loadDatabaseUrl() } } });

async function main() {
  console.log('file', xlsxPath);
  const rows = await readRows(xlsxPath);
  console.log('rows', rows.length);

  const clinic = await prisma.clinic.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!clinic) throw new Error('Klinika topilmadi');
  const branch = await prisma.branch.findFirst({
    where: { clinicId: clinic.id, isActive: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!branch) throw new Error('Filial topilmadi');
  console.log('clinic', clinic.name, 'branch', branch.name);

  let created = 0;
  let updated = 0;
  for (const row of rows) {
    const existing = await prisma.inpatientRoom.findFirst({
      where: { branchId: branch.id, floor: row.floor, number: row.number },
    });
    if (existing) {
      await prisma.inpatientRoom.update({
        where: { id: existing.id },
        data: {
          name: row.name,
          capacity: row.capacity,
          pricePerDay: row.pricePerDay,
          isActive: true,
        },
      });
      updated += 1;
      console.log('updated', row.code, `→ ${row.floor}-etaj ${row.number}`, row.pricePerDay);
    } else {
      await prisma.inpatientRoom.create({
        data: {
          clinicId: clinic.id,
          branchId: branch.id,
          floor: row.floor,
          number: row.number,
          name: row.name,
          capacity: row.capacity,
          pricePerDay: row.pricePerDay,
          isActive: true,
        },
      });
      created += 1;
      console.log('created', row.code, `→ ${row.floor}-etaj ${row.number}`, row.pricePerDay);
    }
  }

  const byFloor = await prisma.inpatientRoom.groupBy({
    by: ['floor'],
    where: { branchId: branch.id, isActive: true },
    _count: { _all: true },
    _sum: { capacity: true },
  });
  console.log(JSON.stringify({ created, updated, total: rows.length, byFloor }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
