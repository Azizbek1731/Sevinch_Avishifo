/**
 * Re-group clinic LAB services into Excel price-list sections
 * (Экспресс, Биохимия, Siydik/Моча, …) and update ServiceCategory links.
 *
 * Usage:
 *   node --env-file=.env scripts/sync-lab-sections-from-xlsx.mjs [path-to-xlsx]
 */
import ExcelJS from 'exceljs';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const xlsxPath =
  process.argv[2] ||
  resolve(
    process.env.USERPROFILE || '',
    'Desktop',
    "Ma'lumotlar Avishifo uchun (2).xlsx",
  );

const SECTION_I18N = {
  'Экспресс тест': {
    uz: 'Ekspress testlar',
    ru: 'Экспресс тест',
    en: 'Express tests',
  },
  'Общеклинические анализы': {
    uz: 'Umumklinik tahlillar',
    ru: 'Общеклинические анализы',
    en: 'General clinical',
  },
  ГОРМОНЫ: { uz: 'Gormonlar', ru: 'Гормоны', en: 'Hormones' },
  КОАГУЛОГРАММА: { uz: 'Koagulogramma', ru: 'Коагулограмма', en: 'Coagulation' },
  'БИОХИМ. ИСЛЕДОВАНИЯ': {
    uz: 'Bioximiya',
    ru: 'Биохимические исследования',
    en: 'Biochemistry',
  },
  'АУТОИММУННЫЕ АНАЛИЗЫ': {
    uz: 'Autoimmun tahlillar',
    ru: 'Аутоиммунные анализы',
    en: 'Autoimmune',
  },
  'ПРОЧИЕ ИНФЕКЦИИ': {
    uz: 'Boshqa infeksiyalar',
    ru: 'Прочие инфекции',
    en: 'Other infections',
  },
  'Иммунный статус организма': {
    uz: 'Immun status',
    ru: 'Иммунный статус организма',
    en: 'Immune status',
  },
  'TORCH - инфекции (ИФА-Анализы)': {
    uz: 'TORCH infeksiyalari',
    ru: 'TORCH-инфекции (ИФА)',
    en: 'TORCH infections',
  },
  'ВИРУСНЫЕ ЗАБОЛЕВАНИЯ (ГЕПАТИТЫ НА ИХЛА)': {
    uz: 'Virusli gepatitlar (IHLA)',
    ru: 'Вирусные заболевания (гепатиты на IHLA)',
    en: 'Viral hepatitis (IHLA)',
  },
  'СЕРОЛОГИЧЕСКИЙ АНАЛИЗ КРОВИ': {
    uz: 'Serologik qon tahlili',
    ru: 'Серологический анализ крови',
    en: 'Serology',
  },
  'ЛИПИДНЫЙ СПЕКТР': {
    uz: 'Lipid spektri',
    ru: 'Липидный спектр',
    en: 'Lipid panel',
  },
  'ЭЛЕКТРОЛИТЫ В КРОВИ': {
    uz: 'Elektrolitlar',
    ru: 'Электролиты в крови',
    en: 'Electrolytes',
  },
  ВИТАМИНЫ: { uz: 'Vitaminlar', ru: 'Витамины', en: 'Vitamins' },
  'АНАЛИЗ МОЧИ': { uz: 'Siydik tahlillari', ru: 'Анализ мочи', en: 'Urinalysis' },
  'АНАЛИЗЫ ОСТРОЙ ФАЗЫ': {
    uz: "O'tkir faza ko'rsatkichlari",
    ru: 'Анализы острой фазы',
    en: 'Acute phase',
  },
  'КОПРОЛОГИЧЕСКИЕ ИССЛЕДОВАНИЕ': {
    uz: 'Najas tahlillari',
    ru: 'Копрологические исследования',
    en: 'Stool tests',
  },
  'СПЕЦИАЛЬНЫЕ ИССЛЕДОВАНИЯ': {
    uz: 'Maxsus tekshiruvlar',
    ru: 'Специальные исследования',
    en: 'Special tests',
  },
  'МИКРОСКОПИЧЕСКИЕ ИССЛЕДОВАНИЕ': {
    uz: 'Mikroskopik tekshiruvlar',
    ru: 'Микроскопические исследования',
    en: 'Microscopy',
  },
};

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
  const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='));
  if (!line) throw new Error('DATABASE_URL missing');
  return line.slice('DATABASE_URL='.length).trim();
}

function cellText(cell) {
  if (!cell || cell.value == null) return '';
  let v = cell.value;
  if (typeof v === 'object') {
    if (v.richText) v = v.richText.map((t) => t.text).join('');
    else if (v.text) v = v.text;
    else if (v.result !== undefined) v = v.result;
    else return '';
  }
  return String(v).replace(/\s+/g, ' ').trim();
}

function cleanName(name) {
  return name.replace(/^[•·\-\s]+/, '').replace(/\s+/g, ' ').trim();
}

function isPriceHeader(price) {
  return /сумма/i.test(price);
}

function isNumericPrice(price) {
  return /^\d+([.,]\d+)?$/.test(String(price).replace(/\s/g, ''));
}

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/холестерол/g, 'холестерин')
    .replace(/лпнл/g, 'лпнп')
    .replace(/анти[-\s]?фосфолипид\w*(?:\s+скрин)?/g, 'антифосфолипидные антитела')
    .replace(/дигидротестерон/g, 'дигидротестостерон')
    .replace(/гомоцестеин/g, 'гомоцистеин')
    .replace(/тропонин/g, 'тропонин')
    .replace(/тропанин/g, 'тропонин')
    .replace(/иммуноглабулин/g, 'иммуноглобулин')
    .replace(/гликированний гемоглабин/g, 'гликированный гемоглобин')
    .replace(/инсулиннор взистентность/g, 'инсулинорезистентности')
    .replace(/инсулинноподобный/g, 'инсулиноподобный')
    .replace(/ничепаренко/g, 'нечипоренко')
    .replace(/желечные/g, 'желчные')
    .replace(/скрытие кровотечение/g, 'скрытую кровь')
    .replace(/яйца глист\b/g, 'яйца глистов')
    .replace(/спермаграмма/g, 'спермограмма')
    .replace(/костный мозг/g, 'костного мозга')
    .replace(/пцр качество/g, 'пцр качественный')
    .replace(/пцр количество/g, 'пцр количественный')
    .replace(/дэас/g, 'дгэа с')
    .replace(/[ʼ'`´]/g, "'")
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Loose token overlap for RU catalogue names vs Excel rows. */
function scoreMatch(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 100;
  // Short labels like "IgG" must only map to total immunoglobulin rows
  // (before substring checks — otherwise "igg" matches every TORCH *IgG* row).
  if (/^(igg|igm|iga|ige)$/.test(na)) {
    if (!nb.includes('общий иммуноглобулин')) return 0;
    if (!nb.includes(`(${na})`) && !nb.split(' ').includes(na)) return 0;
    return 95;
  }
  if (na.includes(nb) || nb.includes(na)) return 88;
  const ta = new Set(na.split(' ').filter((t) => t.length > 1));
  const tb = new Set(nb.split(' ').filter((t) => t.length > 1));
  if (!ta.size || !tb.size) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit += 1;
  const dice = (200 * hit) / (ta.size + tb.size);
  // Prefer distinctive analyte codes (psa, crp, homa, hba1c, …).
  const codes = ['psa', 'crp', 'homa', 'hba1c', 'ana', 'rw'];
  let bonus = 0;
  for (const code of codes) {
    if (na.includes(code) && nb.includes(code)) bonus += 12;
  }
  return Math.min(99, Math.round(dice + bonus));
}

async function parseSections(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('Workbook has no sheets');
  const sections = new Map();
  let leftSec = null;
  let rightSec = null;

  function add(title, name) {
    if (!title || !name) return;
    const cleaned = cleanName(name);
    if (!cleaned || /^наименование$/i.test(cleaned)) return;
    if (!sections.has(title)) sections.set(title, []);
    sections.get(title).push(cleaned);
  }

  for (let r = 2; r <= (ws.rowCount || 0); r += 1) {
    const row = ws.getRow(r);
    const leftTube = cellText(row.getCell(1));
    const leftName = cellText(row.getCell(2));
    const leftPrice = cellText(row.getCell(3));
    const rightTube = cellText(row.getCell(6));
    const rightName = cellText(row.getCell(7));
    const rightPrice = cellText(row.getCell(8));

    const leftIsHeader =
      (leftName && isPriceHeader(leftPrice)) ||
      (leftName && /цвет пробирки/i.test(leftTube));
    const rightIsHeader =
      (rightName && isPriceHeader(rightPrice)) ||
      (rightName && /цвет пробирки/i.test(rightTube));

    if (leftIsHeader) {
      leftSec = cleanName(leftName);
      if (/^наименование$/i.test(leftSec)) leftSec = 'СПЕЦИАЛЬНЫЕ ИССЛЕДОВАНИЯ';
    } else if (leftName && leftSec && (isNumericPrice(leftPrice) || !leftPrice)) {
      add(leftSec, leftName);
    }

    if (rightIsHeader) {
      rightSec = cleanName(rightName);
    } else if (rightName && rightSec && (isNumericPrice(rightPrice) || !rightPrice)) {
      add(rightSec, rightName);
    }
  }

  return [...sections.entries()].map(([title, items], idx) => ({
    title,
    sortOrder: (idx + 1) * 10,
    items,
  }));
}

function pickName(json) {
  if (!json || typeof json !== 'object') return '';
  return json.ru || json.uz || json.en || Object.values(json).find((v) => typeof v === 'string') || '';
}

const prisma = new PrismaClient({ datasources: { db: { url: loadDatabaseUrl() } } });

async function main() {
  const sections = await parseSections(xlsxPath);
  console.log(`Parsed ${sections.length} sections from ${xlsxPath}`);

  const clinics = await prisma.clinic.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, name: true },
  });
  if (clinics.length !== 1) {
    throw new Error(`Expected 1 ACTIVE clinic, found ${clinics.length}`);
  }
  const clinicId = clinics[0].id;
  console.log(`Clinic: ${clinics[0].name}`);

  const services = await prisma.service.findMany({
    where: { clinicId, isActive: true, category: { kind: 'LAB' } },
    include: { category: true },
  });
  console.log(`Active LAB services: ${services.length}`);

  const used = new Set();
  const plan = []; // { serviceId, sectionTitle, sortOrder, name }

  for (const section of sections) {
    for (const excelName of section.items) {
      let best = null;
      let bestScore = 0;
      for (const service of services) {
        if (used.has(service.id)) continue;
        const score = scoreMatch(excelName, pickName(service.name));
        if (score > bestScore) {
          bestScore = score;
          best = service;
        }
      }
      if (!best || bestScore < 48) {
        console.warn(`  ! no match (${bestScore}): [${section.title}] ${excelName}`);
        continue;
      }
      used.add(best.id);
      plan.push({
        serviceId: best.id,
        code: best.code,
        sectionTitle: section.title,
        sortOrder: section.sortOrder,
        excelName,
        serviceName: pickName(best.name),
        score: bestScore,
      });
    }
  }

  const unmatched = services.filter((s) => !used.has(s.id));
  console.log(`Matched ${plan.length}, unmatched ${unmatched.length}`);

  const existingCats = await prisma.serviceCategory.findMany({
    where: { clinicId, kind: 'LAB' },
  });

  // Upsert section categories (ServiceCategory.name is a plain string — Uzbek label).
  const categoryByTitle = new Map();
  for (const section of sections) {
    const i18n = SECTION_I18N[section.title] || {
      uz: section.title,
      ru: section.title,
      en: section.title,
    };
    const label = i18n.uz;
    let cat = existingCats.find(
      (c) => c.name === label || c.name === i18n.ru || c.name === section.title,
    );
    if (!cat) {
      cat = await prisma.serviceCategory.create({
        data: {
          clinicId,
          kind: 'LAB',
          name: label,
          sortOrder: section.sortOrder,
          isActive: true,
        },
      });
      existingCats.push(cat);
      console.log(`+ category ${label}`);
    } else {
      cat = await prisma.serviceCategory.update({
        where: { id: cat.id },
        data: { name: label, sortOrder: section.sortOrder, isActive: true },
      });
    }
    categoryByTitle.set(section.title, cat.id);
  }

  // Catch-all for leftovers
  let otherCat = existingCats.find((c) => c.name === 'Boshqa' || c.name === 'Прочее');
  if (!otherCat) {
    otherCat = await prisma.serviceCategory.create({
      data: {
        clinicId,
        kind: 'LAB',
        name: 'Boshqa',
        sortOrder: 900,
        isActive: true,
      },
    });
  }

  let moved = 0;
  for (const row of plan) {
    const categoryId = categoryByTitle.get(row.sectionTitle);
    if (!categoryId) continue;
    await prisma.service.update({
      where: { id: row.serviceId },
      data: { categoryId },
    });
    moved += 1;
  }
  for (const service of unmatched) {
    await prisma.service.update({
      where: { id: service.id },
      data: { categoryId: otherCat.id },
    });
  }

  // Deactivate the old monolithic "Laboratoriya" category if empty
  const legacy = await prisma.serviceCategory.findMany({
    where: { clinicId, kind: 'LAB' },
    include: { _count: { select: { services: true } } },
  });
  for (const cat of legacy) {
    if (cat.name === 'Laboratoriya' && cat._count.services === 0) {
      await prisma.serviceCategory.update({
        where: { id: cat.id },
        data: { isActive: false },
      });
      console.log('Deactivated empty Laboratoriya category');
    }
  }

  console.log(`Moved ${moved} services into Excel sections.`);
  if (unmatched.length) {
    console.log('Unmatched → Boshqa:');
    for (const s of unmatched) console.log(' -', s.code, pickName(s.name));
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
