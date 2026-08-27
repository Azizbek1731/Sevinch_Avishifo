/**
 * A single, fully-populated demo clinic — two months of history in every module
 * the product has a screen for. Meant to be run against a LIVE database next to
 * real clinics, which is why it differs from prisma/seed.ts in three ways:
 *
 *   - it is ADDITIVE: it creates one clinic and touches nothing outside it;
 *   - it is IDEMPOTENT: re-running deletes only its own clinic and rebuilds it;
 *   - it never resets the database or seeds the global dictionaries.
 *
 *   pnpm --filter @avishifo/api demo:seed
 *
 * Data is deterministic (fixed PRNG seed) relative to the run date, so a rebuild
 * on the same day reproduces the same clinic.
 */
import {
  Gender,
  Prisma,
  PrismaClient,
  type AppointmentStatus,
  type InvoiceStatus,
  type PaymentMethod,
  type TicketStatus,
} from '@prisma/client';
import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';

import { ICD10_CODES } from './seed-data/icd10';
import { LAB_TEST_DEFS } from './seed-data/lab-tests';
import {
  ALLERGY_POOL,
  CHRONIC_POOL,
  FEMALE_FIRST_NAMES,
  LAST_NAMES,
  MALE_FIRST_NAMES,
  TASHKENT_STREETS,
} from './seed-data/names';
import { DRUGS, PACKAGE_DEFS, SERVICE_DEFS, type CategoryKey } from './seed-data/services';
import { NOTIFICATION_TEMPLATE_DEFS } from './seed-data/templates';

const prisma = new PrismaClient();

// ============================================================ what to build
const DEMO = {
  clinicName: 'Shifo Demo klinikasi',
  legalName: '"SHIFO DEMO" MCHJ',
  emailDomain: 'demo.avishifo.uz',
  password: 'Demo2026!',
  /** Staff phones are +99890 555 00NN — a block no real clinic in the DB uses. */
  staffPhonePrefix: '+99890555',
  patientPhonePrefix: '+99893444',
  historyDays: 60,
  patientCount: 90,
} as const;

// ============================================================ deterministic PRNG
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260825);
const randInt = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const chance = (p: number) => rand() < p;
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ============================================================ Asia/Tashkent (+05:00)
const HOUR = 3_600_000;
const TK = 5;
const nowTk = new Date(Date.now() + TK * HOUR);
const TODAY = { y: nowTk.getUTCFullYear(), m: nowTk.getUTCMonth(), d: nowTk.getUTCDate() };
const tk = (y: number, m: number, d: number, hh = 0, mi = 0) =>
  new Date(Date.UTC(y, m, d, hh, mi) - TK * HOUR);
const day = (offset: number, hh = 0, mi = 0) => tk(TODAY.y, TODAY.m, TODAY.d + offset, hh, mi);
/** UTC-midnight Date for a Tashkent calendar day (@db.Date columns). */
const dateOnly = (offset: number) => new Date(Date.UTC(TODAY.y, TODAY.m, TODAY.d + offset));
const isoWeekday = (offset: number) => {
  const wd = dateOnly(offset).getUTCDay();
  return wd === 0 ? 7 : wd;
};
const addMin = (d: Date, min: number) => new Date(d.getTime() + min * 60_000);
const money = (n: number) => n.toFixed(2);
const uuid = () => randomUUID();
/** "2026-07" for a day offset — payroll periods. */
const periodOf = (offset: number) => {
  const d = dateOnly(offset);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

// ============================================================ prose pools
const SUBJECTIVE = [
  "Ko'krak qafasida bosuvchi og'riq, zinapoyaga ko'tarilganda kuchayadi.",
  'Bosh og\'rig\'i, ko\'z oldida "chivinlar", ertalab yomon.',
  "Yo'talib, kechqurun harorat 37.8 gacha ko'tarilyapti.",
  "Qorin yuqori qismida achishish, ovqatdan keyin kuchayadi.",
  "Bel sohasida og'riq, o'ng oyoqqa uzatiladi.",
  "Umumiy holsizlik, tez charchash, uyqu buzilgan.",
];
const OBJECTIVE = [
  "Umumiy ahvol qoniqarli. Teri qoplamalari toza. O'pkada vezikulyar nafas.",
  "Yurak tonlari bo'g'iq, ritm to'g'ri. AB 140/90 mm sim.ust.",
  "Tomoq giperemiyalangan, bodomcha bezlar kattalashgan.",
  "Qorin yumshoq, epigastriyda palpatsiyada og'riqli.",
  "Umurtqa harakati chegaralangan, paravertebral mushaklar taranglashgan.",
];
const ASSESSMENT = [
  'Arterial gipertenziya, 2-daraja. Yurak yetishmovchiligi belgilarisiz.',
  "O'tkir respirator virusli infeksiya, o'rtacha og'irlikda.",
  'Surunkali gastrit, qo\'zg\'alish bosqichida.',
  'Bel-dumg\'aza radikulopatiyasi.',
  "Temir tanqisligi anemiyasi, yengil daraja.",
];
const PLAN = [
  "Dori-darmon tayinlandi. 10 kundan keyin takroriy ko'rik. Tuzsiz parhez.",
  "Ko'p suyuqlik, yotoq rejimi 3 kun. Harorat 38.5 dan oshsa — qo'ng'iroq qiling.",
  "Qon tahlili va UTT tayinlandi. Natijalar bilan qaytish.",
  "Fizioterapiya kursi 7 kun. Og'ir yuk ko'tarish taqiqlanadi.",
];
const FREQ = ["1x1 (ertalab)", '2x1 (ertalab va kechqurun)', '3x1 (ovqatdan keyin)', "kuniga 1 marta kechqurun"];
const INSTR = ["Ovqatdan keyin, ko'p suv bilan.", 'Ovqatdan 30 daqiqa oldin.', "Kechqurun, uyqudan oldin.", 'Sut bilan qabul qilmang.'];
const PATIENT_SOURCES = ['WALK_IN', 'PHONE', 'TELEGRAM', 'REFERRAL', 'INSTAGRAM'] as const;

const ROOMS = [
  { number: '101', name: 'Konsultatsiya xonasi 1', type: 'CONSULTATION' as const },
  { number: '102', name: 'Konsultatsiya xonasi 2', type: 'CONSULTATION' as const },
  { number: '103', name: 'UTT xonasi', type: 'ULTRASOUND' as const },
  { number: '104', name: 'Muolaja xonasi', type: 'PROCEDURE' as const },
  { number: '105', name: 'Laboratoriya', type: 'LAB' as const },
];

const WORKING_HOURS = {
  mon: { from: '09:00', to: '18:00' },
  tue: { from: '09:00', to: '18:00' },
  wed: { from: '09:00', to: '18:00' },
  thu: { from: '09:00', to: '18:00' },
  fri: { from: '09:00', to: '18:00' },
  sat: { from: '09:00', to: '14:00' },
  sun: null,
};

interface DoctorCfg {
  key: string;
  fullName: string;
  local: string;
  specialty: string;
  slotMinutes: number;
  branchIdx: number;
  room: string;
  primary: string[];
  extra: string[];
}
const DOCTORS: DoctorCfg[] = [
  { key: 'kardiolog', fullName: 'Sobirov Jasur Alisher o\'g\'li', local: 'kardiolog', specialty: 'Kardiolog', slotMinutes: 20, branchIdx: 0, room: '101', primary: ['SVC-001'], extra: ['SVC-005'] },
  { key: 'pediatr', fullName: 'Yo\'ldosheva Nigora Rustam qizi', local: 'pediatr', specialty: 'Pediatr', slotMinutes: 15, branchIdx: 0, room: '102', primary: ['SVC-002'], extra: ['SVC-005'] },
  { key: 'nevrolog', fullName: 'Ergashev Bekzod Shuhrat o\'g\'li', local: 'nevrolog', specialty: 'Nevrolog', slotMinutes: 15, branchIdx: 1, room: '101', primary: ['SVC-003'], extra: ['SVC-005'] },
  { key: 'terapevt', fullName: 'Qodirova Dilnoza Anvar qizi', local: 'terapevt', specialty: 'Terapevt', slotMinutes: 15, branchIdx: 1, room: '102', primary: ['SVC-004'], extra: ['SVC-005'] },
];

// ============================================================ teardown
/**
 * Children before parents. Prisma will not cascade most of these, and a demo
 * that cannot be rebuilt is worse than no demo — so the order is spelled out
 * rather than left to the schema.
 */
async function dropExistingDemo(): Promise<void> {
  const existing = await prisma.clinic.findFirst({ where: { name: DEMO.clinicName } });
  if (!existing) return;
  const clinicId = existing.id;
  console.log(`  eski demo klinika topildi (${clinicId}) — o'chirilyapti`);

  const w = { where: { clinicId } };
  // Ward chain: charges reference administrations, which reference orders.
  await prisma.chargeItem.deleteMany(w);
  await prisma.treatmentAdministration.deleteMany(w);
  await prisma.treatmentOrder.deleteMany(w);
  await prisma.admissionDailyNote.deleteMany(w);
  await prisma.admission.deleteMany(w);
  // Money chain.
  await prisma.refund.deleteMany(w);
  await prisma.payment.deleteMany(w);
  await prisma.invoiceLine.deleteMany(w);
  await prisma.invoice.deleteMany(w);
  await prisma.expense.deleteMany(w);
  await prisma.expenseCategory.deleteMany(w);
  await prisma.patientBalanceTransaction.deleteMany(w);
  await prisma.cashierShift.deleteMany(w);
  // Lab chain.
  await prisma.labResultValue.deleteMany(w);
  await prisma.labResult.deleteMany(w);
  await prisma.labOrderItem.deleteMany(w);
  await prisma.patientDocument.deleteMany(w);
  await prisma.labOrder.deleteMany(w);
  // Clinical chain.
  await prisma.referral.deleteMany(w);
  await prisma.visitAmendment.deleteMany(w);
  await prisma.feedback.deleteMany(w);
  await prisma.prescription.deleteMany(w);
  await prisma.diagnosis.deleteMany(w);
  await prisma.visitVital.deleteMany(w);
  await prisma.visit.deleteMany(w);
  await prisma.queueTicket.deleteMany(w);
  await prisma.queue.deleteMany(w);
  await prisma.appointmentService.deleteMany(w);
  await prisma.appointment.deleteMany(w);
  // Patient-owned.
  await prisma.medicalRecordAccess.deleteMany(w);
  await prisma.patientConsent.deleteMany(w);
  await prisma.telegramLink.deleteMany(w);
  await prisma.patient.deleteMany(w);
  // Inventory.
  await prisma.stockMovement.deleteMany(w);
  await prisma.stockBatch.deleteMany(w);
  await prisma.inventoryItem.deleteMany(w);
  await prisma.supplier.deleteMany(w);
  // Catalogue.
  await prisma.packageItem.deleteMany(w);
  await prisma.servicePackage.deleteMany(w);
  await prisma.labTestParameter.deleteMany(w);
  await prisma.labTest.deleteMany(w);
  await prisma.servicePrice.deleteMany(w);
  await prisma.compensationRule.deleteMany(w);
  await prisma.service.deleteMany(w);
  await prisma.serviceCategory.deleteMany(w);
  await prisma.discountRule.deleteMany(w);
  await prisma.visitTemplate.deleteMany(w);
  // Staff-owned.
  await prisma.payrollAccrual.deleteMany(w);
  await prisma.scheduleException.deleteMany(w);
  await prisma.doctorSchedule.deleteMany(w);
  await prisma.staffProfile.deleteMany(w);
  await prisma.inAppNotification.deleteMany(w);
  await prisma.notificationLog.deleteMany(w);
  await prisma.notificationTemplate.deleteMany(w);
  await prisma.auditLog.deleteMany(w);
  await prisma.authSession.deleteMany({ where: { user: { clinicId } } });
  await prisma.userBranch.deleteMany(w);
  await prisma.user.deleteMany(w);
  // Clinic frame.
  await prisma.room.deleteMany(w);
  await prisma.branch.deleteMany(w);
  await prisma.clinicCounter.deleteMany(w);
  await prisma.clinicSubscription.deleteMany(w);
  await prisma.clinic.delete({ where: { id: clinicId } });
  console.log('  eski demo tozalandi');
}

// ============================================================ build
async function main(): Promise<void> {
  console.log(`\n=== ${DEMO.clinicName} — demo ma'lumotlar (${DEMO.historyDays} kun) ===\n`);
  await dropExistingDemo();

  const passwordHash = await argon2.hash(DEMO.password);
  const logins: { role: string; name: string; email: string; phone: string }[] = [];

  // ---- clinic, subscription, branches, rooms ----------------------------
  const plan =
    (await prisma.subscriptionPlan.findFirst({ where: { code: 'PRO' } })) ??
    (await prisma.subscriptionPlan.findFirst({ orderBy: { priceMonthly: 'desc' } }));

  const clinic = await prisma.clinic.create({
    data: {
      name: DEMO.clinicName,
      legalName: DEMO.legalName,
      taxId: '301234567',
      phone: '+998712000000',
      email: `info@${DEMO.emailDomain}`,
      address: "Toshkent sh., Chilonzor t., Bunyodkor ko'chasi, 12",
      defaultLocale: 'uz',
      smsSenderName: 'SHIFODEMO',
      status: 'ACTIVE',
      settings: {
        currency: 'UZS',
        vatPercent: 0,
        queuePrefix: 'A',
        appointmentReminderHours: [24, 2],
        workingHours: WORKING_HOURS,
      },
    },
  });
  const clinicId = clinic.id;

  if (plan) {
    await prisma.clinicSubscription.create({
      data: { clinicId, planId: plan.id, status: 'ACTIVE', startsAt: day(-DEMO.historyDays), endsAt: day(305) },
    });
  }

  const branchDefs = [
    { name: 'Markaziy filial', address: "Toshkent sh., Chilonzor t., Bunyodkor ko'chasi, 12", phone: '+998712000001' },
    { name: 'Yunusobod filiali', address: "Toshkent sh., Yunusobod t., Amir Temur ko'chasi, 108", phone: '+998712000002' },
  ];
  const branchIds: string[] = [];
  const roomIdByKey = new Map<string, string>();
  for (let bi = 0; bi < branchDefs.length; bi++) {
    const b = await prisma.branch.create({
      data: { clinicId, ...branchDefs[bi], workingHours: WORKING_HOURS },
    });
    branchIds.push(b.id);
    for (const r of ROOMS) {
      const room = await prisma.room.create({
        data: { clinicId, branchId: b.id, number: r.number, name: r.name, type: r.type },
      });
      roomIdByKey.set(`${bi}:${r.number}`, room.id);
    }
  }
  console.log(`  filiallar: ${branchIds.length}, xonalar: ${branchIds.length * ROOMS.length}`);

  // ---- staff: one account per role --------------------------------------
  let phoneSeq = 0;
  const nextPhone = () => `${DEMO.staffPhonePrefix}${String(++phoneSeq).padStart(3, '0')}`;

  async function createUser(
    role: 'CLINIC_OWNER' | 'CLINIC_ADMIN' | 'DOCTOR' | 'NURSE' | 'RECEPTIONIST' | 'CASHIER' | 'LAB_TECH' | 'ACCOUNTANT',
    fullName: string,
    local: string,
    branchIdxs: number[],
  ): Promise<string> {
    const email = `${local}@${DEMO.emailDomain}`;
    const phone = nextPhone();
    const user = await prisma.user.create({
      data: { clinicId, phone, email, passwordHash, fullName, role, locale: 'uz' },
    });
    if (branchIdxs.length > 0) {
      await prisma.userBranch.createMany({
        data: branchIdxs.map((bi) => ({ clinicId, userId: user.id, branchId: branchIds[bi] })),
      });
    }
    logins.push({ role, name: fullName, email, phone });
    return user.id;
  }

  const all = branchIds.map((_, i) => i);
  const ownerId = await createUser('CLINIC_OWNER', 'Rahimov Sardor Bahodir o\'g\'li', 'owner', all);
  const adminId = await createUser('CLINIC_ADMIN', 'Tursunova Malika Farrux qizi', 'admin', all);

  const doctorIds: Record<string, string> = {};
  for (const doc of DOCTORS) {
    const id = await createUser('DOCTOR', doc.fullName, doc.local, [doc.branchIdx]);
    doctorIds[doc.key] = id;
    await prisma.staffProfile.create({
      data: {
        clinicId,
        userId: id,
        specialty: doc.specialty,
        licenseNo: `LIC-${randInt(2015, 2024)}-${String(randInt(10000, 99999))}`,
        hireDate: day(-randInt(300, 1200)),
        slotMinutes: doc.slotMinutes,
        defaultRoomId: roomIdByKey.get(`${doc.branchIdx}:${doc.room}`) ?? null,
        bio: `${doc.specialty} — ${randInt(6, 22)} yillik tajriba`,
      },
    });
    await prisma.doctorSchedule.createMany({
      data: [1, 2, 3, 4, 5].flatMap((weekday) => [
        { clinicId, branchId: branchIds[doc.branchIdx], doctorUserId: id, weekday, startTime: '09:00', endTime: '13:00', slotMinutes: doc.slotMinutes },
        { clinicId, branchId: branchIds[doc.branchIdx], doctorUserId: id, weekday, startTime: '14:00', endTime: '18:00', slotMinutes: doc.slotMinutes },
      ]),
    });
  }

  const nurseId = await createUser('NURSE', 'Ismoilova Zilola Oybek qizi', 'hamshira', all);
  const recep1 = await createUser('RECEPTIONIST', 'Karimova Sevara Jamshid qizi', 'qabul1', [0]);
  const recep2 = await createUser('RECEPTIONIST', 'Abdullayeva Nozima Ulug\'bek qizi', 'qabul2', [1]);
  const cashierId = await createUser('CASHIER', 'Toshmatov Aziz Nodir o\'g\'li', 'kassir', all);
  const labTechId = await createUser('LAB_TECH', 'Rasulov Otabek Shavkat o\'g\'li', 'laborant', all);
  const accountantId = await createUser('ACCOUNTANT', 'Yusupova Gulnora Rashid qizi', 'buxgalter', all);
  console.log(`  xodimlar: ${logins.length}`);

  // Doctor time off — the schedule screen is empty without it.
  await prisma.scheduleException.createMany({
    data: [
      { clinicId, doctorUserId: doctorIds.pediatr, type: 'VACATION', dateFrom: dateOnly(12), dateTo: dateOnly(19), note: 'Yillik mehnat ta\'tili' },
      { clinicId, doctorUserId: doctorIds.nevrolog, type: 'SICK_LEAVE', dateFrom: dateOnly(-9), dateTo: dateOnly(-7), note: 'Kasallik varaqasi' },
      { clinicId, doctorUserId: doctorIds.kardiolog, type: 'CUSTOM_HOURS', dateFrom: dateOnly(3), dateTo: dateOnly(3), startTime: '09:00', endTime: '12:00', note: 'Konferensiya — qisqartirilgan kun' },
      { clinicId, doctorUserId: doctorIds.terapevt, type: 'DAY_OFF', dateFrom: dateOnly(6), dateTo: dateOnly(6), note: 'Shaxsiy sabab' },
    ],
  });

  // ---- catalogue --------------------------------------------------------
  const catIdByKind = new Map<CategoryKey, string>();
  for (const c of [
    { name: 'Konsultatsiya', kind: 'CONSULTATION' as const, sortOrder: 1 },
    { name: 'Laboratoriya', kind: 'LAB' as const, sortOrder: 2 },
    { name: 'UTT', kind: 'ULTRASOUND' as const, sortOrder: 3 },
    { name: 'Muolajalar', kind: 'PROCEDURE' as const, sortOrder: 4 },
  ]) {
    const cat = await prisma.serviceCategory.create({ data: { clinicId, name: c.name, kind: c.kind, sortOrder: c.sortOrder } });
    catIdByKind.set(c.kind, cat.id);
  }

  const svc = new Map<string, { id: string; price: number; name: { uz: string; ru: string }; category: CategoryKey }>();
  const serviceRows: Prisma.ServiceCreateManyInput[] = [];
  for (const s of SERVICE_DEFS) {
    const id = uuid();
    svc.set(s.code, { id, price: s.price, name: { uz: s.uz, ru: s.ru }, category: s.category });
    serviceRows.push({ id, clinicId, categoryId: catIdByKind.get(s.category)!, code: s.code, name: { uz: s.uz, ru: s.ru }, durationMin: s.durationMin });
  }
  await prisma.service.createMany({ data: serviceRows });
  // A price history: an older one closed off, and the live one — so the price
  // screen shows a real timeline instead of a single row.
  await prisma.servicePrice.createMany({
    data: SERVICE_DEFS.flatMap((s) => [
      { clinicId, serviceId: svc.get(s.code)!.id, branchId: null, price: money(Math.round((s.price * 0.9) / 1000) * 1000), effectiveFrom: day(-180), effectiveTo: day(-DEMO.historyDays) },
      { clinicId, serviceId: svc.get(s.code)!.id, branchId: null, price: money(s.price), effectiveFrom: day(-DEMO.historyDays) },
    ]),
  });

  for (const p of PACKAGE_DEFS) {
    await prisma.servicePackage.create({
      data: {
        clinicId,
        code: p.code,
        name: { uz: p.uz, ru: p.ru },
        price: money(p.price),
        items: { create: p.serviceCodes.map((code) => ({ clinicId, serviceId: svc.get(code)!.id, quantity: 1 })) },
      },
    });
  }

  await prisma.discountRule.createMany({
    data: [
      { clinicId, name: 'Nafaqaxo\'rlar uchun', type: 'PERCENT', value: money(15), patientTag: 'PENSIONER', maxForRole: { RECEPTIONIST: 15, CASHIER: 15 } },
      { clinicId, name: 'Ko\'p bolali oila', type: 'PERCENT', value: money(10), patientTag: 'FAMILY', maxForRole: { RECEPTIONIST: 10 } },
      { clinicId, name: 'Xodim va oila a\'zolari', type: 'PERCENT', value: money(50), patientTag: 'STAFF', maxForRole: { CLINIC_ADMIN: 50 } },
      { clinicId, name: 'Ochilish aksiyasi', type: 'FIXED', value: money(20_000), promoCode: 'DEMO20', maxForRole: {} },
    ],
  });

  await prisma.visitTemplate.createMany({
    data: [
      { clinicId, specialty: 'Kardiolog', name: 'Kardiologik birlamchi ko\'rik', content: { subjective: SUBJECTIVE[0], objective: OBJECTIVE[1], plan: PLAN[0] } },
      { clinicId, specialty: 'Pediatr', name: 'Bolalar profilaktik ko\'rigi', content: { subjective: 'Shikoyat yo\'q, profilaktik ko\'rik.', objective: OBJECTIVE[0], plan: 'Emlash jadvali bo\'yicha davom etish.' } },
      { clinicId, specialty: 'Terapevt', name: 'O\'RVI standart ko\'rik', content: { subjective: SUBJECTIVE[2], objective: OBJECTIVE[2], plan: PLAN[1] } },
    ],
  });
  console.log(`  xizmatlar: ${SERVICE_DEFS.length}, paketlar: ${PACKAGE_DEFS.length}, chegirmalar: 4, shablonlar: 3`);

  // ---- lab tests --------------------------------------------------------
  const labTests: { id: string; params: { id: string; ranges: any[]; textValue?: string }[] }[] = [];
  for (const t of LAB_TEST_DEFS) {
    const test = await prisma.labTest.create({
      data: { clinicId, serviceId: svc.get(t.serviceCode)!.id, code: t.code, name: { uz: t.uz, ru: t.ru }, specimenType: t.specimenType },
    });
    const params: { id: string; ranges: any[]; textValue?: string }[] = [];
    for (let pi = 0; pi < t.parameters.length; pi++) {
      const p = t.parameters[pi];
      const param = await prisma.labTestParameter.create({
        data: { clinicId, labTestId: test.id, name: p.name, unit: p.unit, referenceRanges: p.ranges, sortOrder: pi },
      });
      params.push({ id: param.id, ranges: p.ranges as any[], textValue: p.textValue });
    }
    labTests.push({ id: test.id, params });
  }
  console.log(`  laboratoriya tahlillari: ${labTests.length}`);

  // ---- ICD-10 + drugs (global dictionaries, already seeded) -------------
  const icdRows = await prisma.icd10Code.findMany({ select: { id: true, code: true }, take: 400 });
  const icdIds = icdRows.map((r) => r.id);
  let drugRows = await prisma.drugDirectory.findMany({ select: { id: true, name: true, strength: true }, take: 200 });
  if (drugRows.length === 0) {
    await prisma.drugDirectory.createMany({
      data: DRUGS.map(([name, form, strength]) => ({ name, form, strength })),
      skipDuplicates: true,
    });
    drugRows = await prisma.drugDirectory.findMany({ select: { id: true, name: true, strength: true }, take: 200 });
  }

  // ---- patients ---------------------------------------------------------
  interface PatientRec { id: string; gender: Gender; fullName: string; phone: string }
  const patients: PatientRec[] = [];
  const patientRows: Prisma.PatientCreateManyInput[] = [];
  for (let i = 0; i < DEMO.patientCount; i++) {
    const id = uuid();
    const gender: Gender = i % 2 === 0 ? 'MALE' : 'FEMALE';
    const first = gender === 'MALE' ? pick(MALE_FIRST_NAMES) : pick(FEMALE_FIRST_NAMES);
    const last = pick(LAST_NAMES);
    const lastName = gender === 'MALE' ? last : `${last}a`;
    const middleName = `${pick(MALE_FIRST_NAMES)} ${gender === 'MALE' ? "o'g'li" : 'qizi'}`;
    const fullName = `${lastName} ${first} ${middleName}`;
    const phone = `${DEMO.patientPhonePrefix}${String(i + 1).padStart(3, '0')}`;
    const tags: string[] = i < 4 ? ['VIP'] : i < 8 ? ['DEBTOR'] : i < 12 ? ['PENSIONER'] : [];
    const deposit = i >= 12 && i <= 15 ? [100_000, 250_000, 400_000, 150_000][i - 12] : 0;
    patients.push({ id, gender, fullName, phone });
    patientRows.push({
      id, clinicId, mrn: `D-${String(i + 1).padStart(5, '0')}`,
      firstName: first, lastName, middleName, fullName,
      dob: new Date(Date.UTC(randInt(1948, 2021), randInt(0, 11), randInt(1, 28))),
      gender, phone,
      address: `Toshkent sh., ${pick(TASHKENT_STREETS).replace('Toshkent sh., ', '')}, ${randInt(1, 140)}-uy`,
      bloodGroup: pick(['A_POS', 'B_POS', 'O_POS', 'AB_POS', 'A_NEG', 'O_NEG', 'UNKNOWN'] as const),
      allergies: chance(0.22) ? [pick(ALLERGY_POOL)] : [],
      chronicConditions: chance(0.18) ? [pick(CHRONIC_POOL)] : [],
      source: pick(PATIENT_SOURCES),
      tags,
      balance: money(deposit),
      careType: pick(['AMBULATORY', 'AMBULATORY', 'AMBULATORY', 'INPATIENT'] as const),
      createdAt: day(-randInt(0, DEMO.historyDays), randInt(9, 17), randInt(0, 59)),
    });
  }
  await prisma.patient.createMany({ data: patientRows });

  await prisma.patientBalanceTransaction.createMany({
    data: [12, 13, 14, 15].map((i) => ({
      clinicId, patientId: patients[i].id, type: 'DEPOSIT' as const,
      amount: money([100_000, 250_000, 400_000, 150_000][i - 12]),
      note: "Avans to'lovi (depozit)", createdById: cashierId,
      createdAt: day(-randInt(5, 40), 11, 0),
    })),
  });

  // Consent, portal access and Telegram — the patient card shows all three.
  await prisma.patientConsent.createMany({
    data: patients.slice(0, 60).map((p, i) => ({
      clinicId, patientId: p.id, type: 'personal_data',
      signedAt: day(-randInt(1, DEMO.historyDays), 10, 0),
      note: i % 9 === 0 ? "Qog'oz nusxa qabulxonada saqlanadi" : null,
    })),
  });
  await prisma.telegramLink.createMany({
    data: patients.slice(0, 25).map((p, i) => ({
      clinicId, patientId: p.id, chatId: `9${String(100000 + i)}`, phone: p.phone, isActive: true,
      createdAt: day(-randInt(1, DEMO.historyDays), 12, 0),
    })),
  });
  for (const p of patients.slice(0, 20)) {
    await prisma.portalAccount.upsert({
      where: { phone: p.phone },
      update: {},
      create: {
        phone: p.phone,
        firstName: p.fullName.split(' ')[1] ?? null,
        lastName: p.fullName.split(' ')[0] ?? null,
        gender: p.gender,
        phoneVerifiedAt: day(-randInt(2, 50), 10, 0),
        lastLoginAt: day(-randInt(0, 10), randInt(9, 20), 0),
      },
    });
  }
  // Record-access requests in each state, so that screen has something to show.
  await prisma.medicalRecordAccess.createMany({
    data: [
      { clinicId, patientId: patients[0].id, status: 'APPROVED', patientNote: 'Tarixni ko\'rmoqchiman', decidedById: adminId, decidedAt: day(-8, 10, 0), requestedAt: day(-9, 15, 0) },
      { clinicId, patientId: patients[1].id, status: 'PENDING', patientNote: 'Boshqa klinikaga taqdim etish uchun', requestedAt: day(-1, 16, 0) },
      { clinicId, patientId: patients[2].id, status: 'REJECTED', patientNote: 'Tarix kerak', decidedById: adminId, decidedAt: day(-14, 11, 0), decisionNote: 'Shaxsi tasdiqlanmadi', requestedAt: day(-15, 9, 0) },
    ],
  });
  console.log(`  bemorlar: ${patients.length} (4 VIP, 4 qarzdor, 4 nafaqaxo'r, 4 depozitli)`);

  // ---- appointments over the whole window -------------------------------
  interface ApptRec {
    id: string; branchId: string; doctorKey: string; doctorId: string; patientId: string;
    startAt: Date; endAt: Date; status: AppointmentStatus; codes: string[]; off: number; slot: number;
  }
  const appts: ApptRec[] = [];
  const apptRows: Prisma.AppointmentCreateManyInput[] = [];
  const nowUtc = new Date();
  for (const doc of DOCTORS) {
    const doctorId = doctorIds[doc.key];
    const branchId = branchIds[doc.branchIdx];
    const roomId = roomIdByKey.get(`${doc.branchIdx}:${doc.room}`) ?? null;
    const slots: number[] = [];
    for (const [a, b] of [[9 * 60, 13 * 60], [14 * 60, 18 * 60]]) {
      for (let m = a; m + doc.slotMinutes <= b; m += doc.slotMinutes) slots.push(m);
    }
    for (let off = -DEMO.historyDays; off <= 10; off++) {
      if (isoWeekday(off) > 5) continue;
      const perDay = off < 0 ? randInt(4, 9) : randInt(3, 7);
      let chosen: number[];
      if (off === 0) {
        // Today is what the dashboard opens on, and it opens on ONE branch —
        // so every doctor gets a guaranteed morning (already seen) and a
        // guaranteed afternoon (still to come). Leaving it to the shuffle once
        // gave a whole branch an afternoon-only day and two zeros on screen.
        const morning = slots.filter((m) => m < 13 * 60);
        const afternoon = slots.filter((m) => m >= 13 * 60);
        chosen = [
          ...shuffle(morning).slice(0, randInt(3, 5)),
          ...shuffle(afternoon).slice(0, randInt(2, 4)),
        ].sort((a, b) => a - b);
      } else {
        chosen = shuffle(slots).slice(0, perDay).sort((a, b) => a - b);
      }
      const dayPatients = shuffle(patients).slice(0, chosen.length);
      for (let k = 0; k < chosen.length; k++) {
        const startAt = day(off, Math.floor(chosen[k] / 60), chosen[k] % 60);
        const endAt = addMin(startAt, doc.slotMinutes);
        const isMorning = chosen[k] < 13 * 60;
        let status: AppointmentStatus;
        if (off < 0) status = chance(0.07) ? 'NO_SHOW' : chance(0.04) ? 'CANCELLED' : 'COMPLETED';
        // Today is split by the clinic's own morning, not by the wall clock:
        // the dashboard opens on "today", and a demo seeded at 4am would show
        // two zeros all day. Morning slots are seen-and-done, the afternoon is
        // still ahead — which is what a clinic looks like when it is shown.
        else if (off === 0) status = isMorning ? (chance(0.75) ? 'COMPLETED' : 'IN_PROGRESS') : chance(0.5) ? 'SCHEDULED' : 'CONFIRMED';
        else status = chance(0.5) ? 'SCHEDULED' : 'CONFIRMED';
        const codes = [pick(doc.primary)];
        if (chance(0.35)) codes.push(pick(doc.extra));
        if (chance(0.2)) codes.push(pick(SERVICE_DEFS.filter((s) => s.category === 'LAB')).code);
        const rec: ApptRec = { id: uuid(), branchId, doctorKey: doc.key, doctorId, patientId: dayPatients[k].id, startAt, endAt, status, codes, off, slot: doc.slotMinutes };
        appts.push(rec);
        apptRows.push({
          id: rec.id, clinicId, branchId, patientId: rec.patientId, doctorUserId: doctorId, roomId,
          startAt, endAt, status, createdById: off % 2 === 0 ? recep1 : recep2,
          createdAt: addMin(startAt, -randInt(60, 7200)),
        });
      }
    }
  }
  await prisma.appointment.createMany({ data: apptRows });
  await prisma.appointmentService.createMany({
    data: appts.flatMap((a) => a.codes.map((code) => ({ clinicId, appointmentId: a.id, serviceId: svc.get(code)!.id }))),
  });
  console.log(`  qabullar: ${appts.length}`);

  // ---- cashier shifts ---------------------------------------------------
  const shiftByDay = new Map<string, string>();
  for (let off = -DEMO.historyDays; off <= -1; off++) {
    if (isoWeekday(off) > 6) continue;
    for (const branchId of branchIds) {
      const s = await prisma.cashierShift.create({
        data: {
          clinicId, branchId, cashierUserId: cashierId, status: 'CLOSED',
          openedAt: day(off, 8, 30), closedAt: day(off, 18, 30),
          openingCash: money(200_000), closedById: cashierId,
        },
      });
      shiftByDay.set(`${off}:${branchId}`, s.id);
    }
  }
  const openShift = await prisma.cashierShift.create({
    data: { clinicId, branchId: branchIds[0], cashierUserId: cashierId, status: 'OPEN', openedAt: day(0, 8, 30), openingCash: money(200_000) },
  });
  shiftByDay.set(`0:${branchIds[0]}`, openShift.id);

  // ---- visits + EHR -----------------------------------------------------
  interface VisitRec { id: string; appt: ApptRec; startedAt: Date; completedAt: Date }
  const visits: VisitRec[] = [];
  const visitRows: Prisma.VisitCreateManyInput[] = [];
  const vitalRows: Prisma.VisitVitalCreateManyInput[] = [];
  const diagRows: Prisma.DiagnosisCreateManyInput[] = [];
  const rxRows: Prisma.PrescriptionCreateManyInput[] = [];
  for (const a of appts) {
    // Every one of today's finished appointments becomes a visit; on past days
    // a fifth are left without one, the way a real clinic's records look.
    if (a.off > 0 || a.status !== 'COMPLETED') continue;
    if (a.off < 0 && !chance(0.8)) continue;
    const id = uuid();
    const startedAt = addMin(a.startAt, randInt(1, 6));
    const completedAt = addMin(startedAt, randInt(Math.max(5, a.slot - 6), a.slot + 4));
    visits.push({ id, appt: a, startedAt, completedAt });
    visitRows.push({
      id, clinicId, branchId: a.branchId, patientId: a.patientId, doctorUserId: a.doctorId,
      appointmentId: a.id, status: 'COMPLETED',
      subjective: pick(SUBJECTIVE), objective: pick(OBJECTIVE), assessmentNote: pick(ASSESSMENT), plan: pick(PLAN),
      startedAt, completedAt, lockedAt: addMin(completedAt, 24 * 60),
      nextVisitAt: chance(0.25) ? addMin(a.startAt, randInt(7, 30) * 24 * 60) : null,
    });
    vitalRows.push({
      clinicId, visitId: id, heightCm: randInt(150, 192), weightKg: randInt(46, 110),
      bpSystolic: randInt(105, 158), bpDiastolic: randInt(64, 96), pulseBpm: randInt(56, 98),
      temperatureC: Math.round((36.3 + rand() * 1.6) * 10) / 10, spo2: randInt(94, 99),
      recordedById: nurseId, recordedAt: startedAt,
    });
    if (icdIds.length > 0) {
      shuffle(icdIds).slice(0, randInt(1, 2)).forEach((icd10Id, ci) =>
        diagRows.push({ clinicId, visitId: id, icd10Id, isPrimary: ci === 0, createdAt: completedAt }),
      );
    }
    for (let r = 0; r < randInt(1, 3); r++) {
      const drug = pick(drugRows);
      rxRows.push({
        clinicId, visitId: id, drugName: drug.name, drugId: drug.id, dosage: drug.strength,
        frequency: pick(FREQ), durationDays: randInt(5, 14), instructions: pick(INSTR), createdAt: completedAt,
      });
    }
  }
  await prisma.visit.createMany({ data: visitRows });
  await prisma.visitVital.createMany({ data: vitalRows });
  if (diagRows.length > 0) await prisma.diagnosis.createMany({ data: diagRows });
  await prisma.prescription.createMany({ data: rxRows });

  // A couple of amended visits — the audit trail on the visit screen.
  await prisma.visitAmendment.createMany({
    data: visits.slice(0, 3).map((v) => ({
      clinicId, visitId: v.id, authorId: v.appt.doctorId,
      diff: { plan: { from: 'Dori-darmon tayinlandi.', to: pick(PLAN) } },
      reason: "Tahlil natijasidan keyin reja aniqlashtirildi",
      createdAt: addMin(v.completedAt, 60),
    })),
  });
  console.log(`  tashriflar: ${visits.length} (retsept ${rxRows.length}, tashxis ${diagRows.length})`);

  // ---- queue (today) ----------------------------------------------------
  const todayAppts = appts.filter((a) => a.off === 0);
  let ticketTotal = 0;
  for (let bi = 0; bi < branchIds.length; bi++) {
    const branchId = branchIds[bi];
    const q = await prisma.queue.create({
      data: { clinicId, branchId, kind: 'DOCTOR', prefix: 'A', date: dateOnly(0), isOpen: true, lastNumber: 0 },
    });
    const mine = todayAppts.filter((a) => a.branchId === branchId).sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
    let n = 0;
    const rows: Prisma.QueueTicketCreateManyInput[] = [];
    for (const a of mine) {
      n++;
      // Same morning/afternoon split the appointments use, so the board is not
      // a wall of "waiting" when the demo is opened before the clinic opens.
      const past = a.status === 'COMPLETED' || a.status === 'IN_PROGRESS';
      const status: TicketStatus = past ? (chance(0.7) ? 'DONE' : chance(0.6) ? 'IN_ROOM' : 'SKIPPED') : 'WAITING';
      rows.push({
        clinicId, branchId, queueId: q.id, number: n, patientId: a.patientId, doctorUserId: a.doctorId,
        appointmentId: a.id, status, priority: chance(0.06) ? 'EMERGENCY' : chance(0.12) ? 'PRIORITY' : 'NORMAL', position: n,
        roomId: roomIdByKey.get(`${bi}:${DOCTORS.find((d) => d.key === a.doctorKey)?.room ?? '101'}`) ?? null,
        calledAt: status === 'WAITING' ? null : addMin(a.startAt, 2),
        startedAt: status === 'IN_ROOM' || status === 'DONE' ? addMin(a.startAt, 4) : null,
        finishedAt: status === 'DONE' ? addMin(a.startAt, a.slot) : null,
        skippedAt: status === 'SKIPPED' ? addMin(a.startAt, 6) : null,
        createdAt: addMin(a.startAt, -randInt(10, 90)),
      });
    }
    if (rows.length > 0) await prisma.queueTicket.createMany({ data: rows });
    await prisma.queue.update({ where: { id: q.id }, data: { lastNumber: n } });
    ticketTotal += rows.length;
  }
  console.log(`  navbat: bugun ${ticketTotal} talon`);

  // ---- lab orders, referrals, results, documents ------------------------
  let labSeq = 0;
  const labVisits = visits.filter(() => chance(0.4));
  let resultCount = 0;
  for (const v of labVisits) {
    const order = await prisma.labOrder.create({
      data: {
        clinicId, branchId: v.appt.branchId, orderNumber: `LAB-${String(++labSeq).padStart(6, '0')}`,
        patientId: v.appt.patientId, visitId: v.id,
        status: 'DELIVERED', orderedById: v.appt.doctorId,
        collectedAt: addMin(v.completedAt, 20), deliveredAt: addMin(v.completedAt, 24 * 60),
        createdAt: v.completedAt,
      },
    });
    await prisma.referral.create({
      data: { clinicId, visitId: v.id, type: 'LAB', labOrderId: order.id, note: 'Tahlilga yo\'llanma', createdAt: v.completedAt },
    });
    for (const t of shuffle(labTests).slice(0, randInt(1, 2))) {
      const item = await prisma.labOrderItem.create({ data: { clinicId, orderId: order.id, labTestId: t.id } });
      const result = await prisma.labResult.create({
        data: {
          clinicId, orderItemId: item.id, enteredById: labTechId, approvedById: labTechId,
          approvedAt: addMin(v.completedAt, 20 * 60), createdAt: addMin(v.completedAt, 18 * 60),
        },
      });
      resultCount++;
      const values: Prisma.LabResultValueCreateManyInput[] = t.params.map((p) => {
        if (p.textValue !== undefined) {
          return { clinicId, resultId: result.id, parameterId: p.id, value: p.textValue, flag: 'NORMAL' as const };
        }
        const r = (p.ranges?.[0] ?? {}) as { min?: number; max?: number };
        const lo = typeof r.min === 'number' ? r.min : 1;
        const hi = typeof r.max === 'number' ? r.max : 10;
        const span = hi - lo || 1;
        // Mostly normal, sometimes out of band — a demo with no abnormal row
        // never shows what the flag colours are for.
        const roll = rand();
        const num = roll < 0.78 ? lo + rand() * span : roll < 0.9 ? hi + rand() * span * 0.3 : Math.max(0, lo - rand() * span * 0.3);
        const flag = num > hi ? 'HIGH' : num < lo ? 'LOW' : 'NORMAL';
        return { clinicId, resultId: result.id, parameterId: p.id, value: num.toFixed(2), flag };
      });
      if (values.length > 0) await prisma.labResultValue.createMany({ data: values });
    }
    // A scanned PDF alongside the structured result.
    if (chance(0.25)) {
      await prisma.patientDocument.create({
        data: {
          clinicId, patientId: v.appt.patientId, labOrderId: order.id, category: 'ANALYSIS',
          title: 'Tahlil natijasi (skan)', fileKey: `${clinicId}/patients/${uuid()}`,
          fileName: `natija-${labSeq}.pdf`, mimeType: 'application/pdf', sizeBytes: randInt(80_000, 400_000),
          uploadedById: labTechId, createdAt: addMin(v.completedAt, 22 * 60),
        },
      });
    }
  }
  // Specialist referrals too, not only lab.
  await prisma.referral.createMany({
    data: visits.slice(0, 12).map((v) => ({
      clinicId, visitId: v.id, type: 'SPECIALIST' as const,
      targetSpecialty: pick(['Kardiolog', 'Nevrolog', 'Endokrinolog', 'Oftalmolog']),
      note: 'Mutaxassis konsultatsiyasi tavsiya etiladi', createdAt: v.completedAt,
    })),
  });
  console.log(`  laboratoriya: ${labSeq} buyurtma, ${resultCount} natija`);

  // Other patient documents.
  await prisma.patientDocument.createMany({
    data: patients.slice(0, 18).map((p, i) => ({
      clinicId, patientId: p.id,
      category: (['IMAGING', 'DISCHARGE', 'CONSENT', 'OTHER'] as const)[i % 4],
      title: (['Rentgen tasviri', 'Statsionardan chiqarish xulosasi', 'Rozilik varaqasi', 'Boshqa hujjat'] as const)[i % 4],
      fileKey: `${clinicId}/patients/${uuid()}`,
      fileName: `hujjat-${i + 1}.pdf`, mimeType: 'application/pdf', sizeBytes: randInt(50_000, 900_000),
      uploadedById: recep1, createdAt: day(-randInt(1, DEMO.historyDays), 12, 0),
    })),
  });

  // ---- invoices, payments, refunds --------------------------------------
  let invSeq = 0;
  const invoiceRows: Prisma.InvoiceCreateManyInput[] = [];
  const lineRows: Prisma.InvoiceLineCreateManyInput[] = [];
  const paymentRows: Prisma.PaymentCreateManyInput[] = [];
  const paidInvoices: { id: string; branchId: string; total: number; issuedAt: Date }[] = [];

  const pickMethod = (): PaymentMethod => {
    const r = rand();
    return r < 0.55 ? 'CASH' : r < 0.8 ? 'CARD' : r < 0.9 ? 'PAYME' : r < 0.97 ? 'CLICK' : 'UZUM';
  };
  const shiftFor = (off: number, branchId: string) => shiftByDay.get(`${off}:${branchId}`) ?? null;

  for (const v of visits) {
    const id = uuid();
    const issuedAt = addMin(v.completedAt, randInt(2, 12));
    let subtotal = 0;
    for (const code of v.appt.codes) {
      const s = svc.get(code)!;
      subtotal += s.price;
      lineRows.push({
        clinicId, invoiceId: id, serviceId: s.id, title: s.name, quantity: 1,
        unitPrice: money(s.price), lineTotal: money(s.price), performerUserId: v.appt.doctorId,
      });
    }
    const roll = rand();
    let status: InvoiceStatus = 'PAID';
    let paid = subtotal;
    if (roll < 0.08) { status = 'PARTIALLY_PAID'; paid = Math.round((subtotal * (0.4 + rand() * 0.3)) / 1000) * 1000; }
    else if (roll < 0.12) { status = 'ISSUED'; paid = 0; }
    invoiceRows.push({
      id, clinicId, branchId: v.appt.branchId, number: `INV-${issuedAt.getUTCFullYear()}-${String(++invSeq).padStart(6, '0')}`,
      patientId: v.appt.patientId, status, subtotal: money(subtotal), total: money(subtotal),
      paidTotal: money(paid), issuedAt, createdById: cashierId, createdAt: issuedAt,
    });
    if (paid > 0) {
      const paidAt = addMin(issuedAt, randInt(3, 45));
      const method = pickMethod();
      paymentRows.push({
        clinicId, branchId: v.appt.branchId, invoiceId: id, amount: money(paid), method, status: 'COMPLETED',
        shiftId: shiftFor(v.appt.off, v.appt.branchId), receivedById: cashierId, paidAt, createdAt: paidAt,
      });
      if (status === 'PAID') paidInvoices.push({ id, branchId: v.appt.branchId, total: subtotal, issuedAt });
    }
  }
  await prisma.invoice.createMany({ data: invoiceRows });
  await prisma.invoiceLine.createMany({ data: lineRows });
  await prisma.payment.createMany({ data: paymentRows });

  // A handful of refunds against fully-paid invoices.
  const refundable = paidInvoices.slice(0, 6);
  for (const inv of refundable) {
    const amount = Math.round((inv.total * (rand() < 0.5 ? 1 : 0.5)) / 1000) * 1000;
    await prisma.refund.create({
      data: {
        clinicId, invoiceId: inv.id, amount: money(amount), method: 'CASH',
        reason: pick(['Xizmat ko\'rsatilmadi', 'Bemor rad etdi', 'Ikki marta to\'langan']),
        approvedById: ownerId, createdById: cashierId, createdAt: addMin(inv.issuedAt, 48 * 60),
      },
    });
  }
  await prisma.invoice.updateMany({
    where: { id: { in: refundable.map((r) => r.id) } },
    data: { status: 'REFUNDED' },
  });
  console.log(`  hisob-fakturalar: ${invoiceRows.length}, to'lovlar: ${paymentRows.length}, qaytarishlar: ${refundable.length}`);

  // ---- ward (statsionar) ------------------------------------------------
  const inpatients = shuffle(patients).slice(0, 10);
  const wardServiceCodes = SERVICE_DEFS.filter((s) => s.category === 'PROCEDURE').map((s) => s.code);
  let admissionCount = 0;
  let orderCount = 0;
  let adminCount = 0;
  for (let i = 0; i < inpatients.length; i++) {
    const p = inpatients[i];
    const admittedOff = -randInt(3, 45);
    const stay = randInt(4, 12);
    const discharged = admittedOff + stay < 0;
    const branchId = branchIds[i % branchIds.length];
    const doctorId = doctorIds[pick(Object.keys(doctorIds))];
    const adm = await prisma.admission.create({
      data: {
        clinicId, branchId, patientId: p.id,
        historyNumber: `ST-${String(i + 1).padStart(4, '0')}`,
        status: discharged ? 'DISCHARGED' : 'ACTIVE',
        department: pick(['Terapiya', 'Kardiologiya', 'Nevrologiya']),
        ward: `${randInt(1, 6)}-palata`, bed: `${randInt(1, 4)}-o'rin`,
        attendingDoctorUserId: doctorId,
        admittedAt: day(admittedOff, 10, 0),
        dischargedAt: discharged ? day(admittedOff + stay, 12, 0) : null,
        referredBy: pick(['Oilaviy poliklinika', 'Tez yordam', "O'z xohishi bilan"]),
        referralDiagnosis: pick(ASSESSMENT),
        admissionDiagnosis: pick(ASSESSMENT),
        clinicalDiagnosis: pick(ASSESSMENT),
        clinicalDiagnosisAt: dateOnly(admittedOff + 1),
        finalDiagnosisMain: discharged ? pick(ASSESSMENT) : null,
        firstTimeThisYear: chance(0.6),
        outcome: discharged ? pick(['RECOVERED', 'IMPROVED', 'IMPROVED', 'UNCHANGED'] as const) : null,
        complaints: pick(SUBJECTIVE),
        anamnesisMorbi: "Kasallik 5 kun oldin boshlangan, holat asta-sekin yomonlashgan.",
        anamnesisVitae: "O'tkazilgan kasalliklar: ORVI. Allergiya anamnezi tinch.",
        objectiveStatus: pick(OBJECTIVE),
        preliminaryDiagnosis: pick(ASSESSMENT),
        treatmentPlan: "Infuzion terapiya, og'riq qoldiruvchi, kuzatuv.",
        epicrisis: discharged ? "Davolash kursini to'liq oldi. Ahvoli yaxshilandi. Ambulator kuzatuv tavsiya etiladi." : null,
        createdAt: day(admittedOff, 10, 0),
      },
    });
    admissionCount++;

    // Daily rounds.
    const noteDays = discharged ? stay : Math.min(stay, -admittedOff);
    for (let d = 0; d < noteDays; d++) {
      await prisma.admissionDailyNote.create({
        data: {
          clinicId, admissionId: adm.id, doctorUserId: doctorId, date: dateOnly(admittedOff + d),
          condition: pick(['Qoniqarli', "O'rtacha og'irlikda", 'Yaxshilanmoqda']),
          temperatureC: Math.round((36.4 + rand() * 1.2) * 10) / 10,
          pulseBpm: randInt(62, 96), bpSystolic: randInt(105, 150), bpDiastolic: randInt(65, 95),
          note: d === 0 ? 'Qabul qilindi, tekshiruvlar tayinlandi.' : pick(['Shikoyatlar kamaydi.', 'Dinamika ijobiy.', 'Davolash davom ettirilmoqda.']),
          createdAt: day(admittedOff + d, 9, 0),
        },
      });
    }

    // Treatment orders: "N kun, kuniga M mahal" — with the doses actually marked.
    for (let o = 0; o < randInt(2, 4); o++) {
      const code = pick(wardServiceCodes);
      const s = svc.get(code)!;
      const timesPerDay = pick([1, 2, 3]);
      const days = Math.min(randInt(3, 7), Math.max(1, noteDays));
      const order = await prisma.treatmentOrder.create({
        data: {
          clinicId, admissionId: adm.id, serviceId: s.id, doctorUserId: doctorId,
          schedule: chance(0.8) ? 'DAILY' : 'EVERY_OTHER_DAY',
          startDate: dateOnly(admittedOff), timesPlanned: days * timesPerDay, timesPerDay,
          note: `${days} kun davomida kuniga ${timesPerDay} mahal`,
          createdAt: day(admittedOff, 11, 0),
        },
      });
      orderCount++;
      for (let d = 0; d < days; d++) {
        for (let slot = 1; slot <= timesPerDay; slot++) {
          const given = chance(0.92);
          const administration = await prisma.treatmentAdministration.create({
            data: {
              clinicId, orderId: order.id, date: dateOnly(admittedOff + d), slot,
              status: given ? 'GIVEN' : 'SKIPPED', markedById: nurseId,
              createdAt: day(admittedOff + d, 8 + slot * 4, 0),
            },
          });
          adminCount++;
          if (given) {
            await prisma.chargeItem.create({
              data: {
                clinicId, branchId, patientId: p.id, admissionId: adm.id,
                administrationId: administration.id, serviceId: s.id, title: s.name,
                date: dateOnly(admittedOff + d), quantity: 1, unitPrice: money(s.price),
                status: discharged ? 'INVOICED' : 'PENDING', createdById: nurseId,
                createdAt: day(admittedOff + d, 8 + slot * 4, 0),
              },
            });
          }
        }
      }
    }
  }
  console.log(`  statsionar: ${admissionCount} yotqizish, ${orderCount} tayinlov, ${adminCount} berilgan doza`);

  // ---- inventory --------------------------------------------------------
  const suppliers = await Promise.all(
    [
      { name: '"MedTexnika" MCHJ', phone: '+998712110011' },
      { name: '"Farm Invest" MCHJ', phone: '+998712110022' },
      { name: '"Lab Servis" XK', phone: '+998712110033' },
    ].map((s) => prisma.supplier.create({ data: { clinicId, ...s, note: 'Doimiy yetkazib beruvchi' } })),
  );
  const itemDefs = [
    { name: 'Bir martalik shprits 5 ml', unit: 'dona', minStock: 200 },
    { name: 'Tibbiy qo\'lqop (M)', unit: 'juft', minStock: 300 },
    { name: 'Fiziologik eritma 0.9% 500ml', unit: 'flakon', minStock: 50 },
    { name: 'Spirtli salfetka', unit: 'dona', minStock: 400 },
    { name: 'Bint steril 5m', unit: 'dona', minStock: 100 },
    { name: 'Probirka EDTA', unit: 'dona', minStock: 250 },
    { name: 'UTT geli 250ml', unit: 'tuba', minStock: 20 },
  ];
  let batchCount = 0;
  let moveCount = 0;
  for (const def of itemDefs) {
    const item = await prisma.inventoryItem.create({ data: { clinicId, ...def } });
    for (let b = 0; b < randInt(1, 2); b++) {
      const qty = randInt(100, 900);
      const batch = await prisma.stockBatch.create({
        data: {
          clinicId, branchId: branchIds[b % branchIds.length], itemId: item.id,
          supplierId: pick(suppliers).id, batchNo: `B-${randInt(1000, 9999)}`,
          expiresAt: dateOnly(randInt(120, 700)), quantity: new Prisma.Decimal(qty),
          unitCost: money(randInt(500, 25_000)), createdAt: day(-randInt(10, DEMO.historyDays), 10, 0),
        },
      });
      batchCount++;
      await prisma.stockMovement.create({
        data: {
          clinicId, branchId: batch.branchId, itemId: item.id, batchId: batch.id, type: 'PURCHASE',
          quantity: new Prisma.Decimal(qty), note: 'Yetkazib berish', createdById: adminId,
          createdAt: batch.createdAt,
        },
      });
      moveCount++;
      for (let m = 0; m < randInt(2, 5); m++) {
        await prisma.stockMovement.create({
          data: {
            clinicId, branchId: batch.branchId, itemId: item.id, batchId: batch.id,
            type: pick(['DEDUCTION', 'DEDUCTION', 'DEDUCTION', 'WRITE_OFF'] as const),
            quantity: new Prisma.Decimal(randInt(5, 60)),
            note: pick(['Muolajaga sarflandi', 'Laboratoriyaga berildi', 'Yaroqsiz — hisobdan chiqarildi']),
            createdById: nurseId, createdAt: day(-randInt(1, 30), randInt(9, 17), 0),
          },
        });
        moveCount++;
      }
    }
  }
  console.log(`  ombor: ${itemDefs.length} nomenklatura, ${batchCount} partiya, ${moveCount} harakat`);

  // ---- expenses ---------------------------------------------------------
  const expCats = await Promise.all(
    ['Ijara', 'Kommunal', 'Oylik maosh', 'Rasxod materiallar', 'Marketing', 'Ta\'mirlash'].map((name) =>
      prisma.expenseCategory.create({ data: { clinicId, name } }),
    ),
  );
  const expenseRows: Prisma.ExpenseCreateManyInput[] = [];
  for (let off = -DEMO.historyDays; off <= 0; off++) {
    if (!chance(0.45)) continue;
    const branchId = pick(branchIds);
    expenseRows.push({
      clinicId, branchId, categoryId: pick(expCats).id,
      amount: money(randInt(1, 60) * 100_000), method: chance(0.7) ? 'CASH' : 'CARD',
      shiftId: shiftFor(off, branchId), date: dateOnly(off),
      note: pick(['Oylik to\'lov', 'Yetkazib beruvchiga', 'Xo\'jalik xarajati', 'Reklama xizmati']),
      createdById: accountantId, createdAt: day(off, randInt(10, 17), 0),
    });
  }
  await prisma.expense.createMany({ data: expenseRows });
  console.log(`  chiqimlar: ${expenseRows.length}`);

  // ---- payroll: compensation rules + two closed months ------------------
  for (const key of Object.keys(doctorIds)) {
    await prisma.compensationRule.create({
      data: {
        clinicId, doctorUserId: doctorIds[key],
        type: chance(0.5) ? 'REVENUE_PERCENT' : 'FIXED_SALARY',
        value: money(chance(0.5) ? 25 : 6_000_000),
        effectiveFrom: day(-DEMO.historyDays),
      },
    });
  }
  const periods = [...new Set([periodOf(-DEMO.historyDays), periodOf(-30), periodOf(0)])];
  for (const period of periods) {
    for (const key of Object.keys(doctorIds)) {
      const base = randInt(4, 8) * 1_000_000;
      const bonus = randInt(0, 5) * 500_000;
      await prisma.payrollAccrual.create({
        data: {
          clinicId, doctorUserId: doctorIds[key], period,
          baseAmount: money(base), bonusAmount: money(bonus), adjustment: money(0),
          total: money(base + bonus),
          breakdown: [
            { label: 'Asosiy maosh', amount: base },
            { label: 'Xizmatlardan ulush', amount: bonus },
          ],
          note: period === periodOf(0) ? 'Joriy oy — hisoblanmoqda' : "To'langan",
        },
      });
    }
  }
  console.log(`  ish haqi: ${periods.length} davr × ${Object.keys(doctorIds).length} shifokor`);

  // ---- feedback ---------------------------------------------------------
  await prisma.feedback.createMany({
    data: shuffle(visits).slice(0, 45).map((v) => {
      const rating = rand() < 0.72 ? 5 : rand() < 0.8 ? 4 : rand() < 0.7 ? 3 : randInt(1, 2);
      return {
        clinicId, branchId: v.appt.branchId, patientId: v.appt.patientId, visitId: v.id,
        doctorUserId: v.appt.doctorId, rating,
        comment: rating >= 4
          ? pick(['Shifokor juda e\'tiborli, rahmat.', 'Tez va sifatli xizmat.', 'Hammasi zo\'r, tavsiya qilaman.', 'Navbat kutmadim.'])
          : pick(['Navbatni uzoq kutdim.', 'Qabulxona xodimi shoshqaloq edi.', 'Natijani kech oldim.']),
        isPublic: rating >= 4 && chance(0.6),
        createdAt: addMin(v.completedAt, randInt(60, 2880)),
      };
    }),
  });

  // ---- notifications ----------------------------------------------------
  await prisma.notificationTemplate.createMany({
    data: NOTIFICATION_TEMPLATE_DEFS.map((t) => ({
      clinicId, event: t.event, channel: t.channel, locale: t.locale, body: t.body, isActive: true,
    })),
    skipDuplicates: true,
  });
  const notifLogRows: Prisma.NotificationLogCreateManyInput[] = [];
  for (let i = 0; i < 120; i++) {
    const p = pick(patients);
    const off = -randInt(0, DEMO.historyDays);
    const ok = chance(0.93);
    notifLogRows.push({
      clinicId, patientId: p.id,
      event: pick(['APPOINTMENT_CREATED', 'APPOINTMENT_REMINDER_24H', 'APPOINTMENT_REMINDER_2H', 'LAB_RESULT_READY', 'PAYMENT_RECEIPT'] as const),
      channel: chance(0.55) ? 'TELEGRAM' : 'SMS',
      recipient: p.phone,
      body: 'Hurmatli bemor, eslatma: qabulingiz belgilangan vaqtda.',
      status: ok ? 'DELIVERED' : 'FAILED',
      error: ok ? null : 'Telefon raqami mavjud emas',
      attempts: ok ? 1 : 3,
      sentAt: ok ? day(off, randInt(9, 19), 0) : null,
      createdAt: day(off, randInt(9, 19), 0),
    });
  }
  await prisma.notificationLog.createMany({ data: notifLogRows });
  await prisma.inAppNotification.createMany({
    data: [ownerId, adminId, cashierId, labTechId].flatMap((userId) =>
      Array.from({ length: 5 }, (_, i) => ({
        clinicId, userId,
        title: pick(['Yangi tahlil natijasi', 'Kassa smenasi yopildi', 'Yangi bemor ro\'yxatdan o\'tdi', 'Qarzdorlik eslatmasi']),
        body: 'Tafsilotlar uchun bosing.',
        link: pick(['/lab', '/registers', '/patients', '/invoices']),
        readAt: i < 3 ? day(-i, 12, 0) : null,
        createdAt: day(-i, randInt(9, 18), 0),
      })),
    ),
  });

  // ---- counters ---------------------------------------------------------
  await prisma.clinicCounter.createMany({
    data: [
      { clinicId, key: 'invoice', value: BigInt(invSeq) },
      { clinicId, key: 'lab_order', value: BigInt(labSeq) },
      { clinicId, key: 'patient_mrn', value: BigInt(DEMO.patientCount) },
    ],
    skipDuplicates: true,
  });

  // ---- report -----------------------------------------------------------
  console.log(`\n=== TAYYOR — ${DEMO.clinicName} ===`);
  console.log(`Parol (barcha hisoblar uchun): ${DEMO.password}\n`);
  console.log('Rol            | Email                              | Telefon');
  console.log('---------------+------------------------------------+---------------');
  for (const l of logins) {
    console.log(`${l.role.padEnd(14)} | ${l.email.padEnd(34)} | ${l.phone}`);
  }
  console.log('');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
