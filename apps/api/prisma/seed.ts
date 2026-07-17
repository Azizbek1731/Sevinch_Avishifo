/**
 * AviShifo demo/dev seed (spec §13). Runs with `tsx prisma/seed.ts` using the
 * raw PrismaClient (no Nest, NO tenant auto-scope — clinicId is set explicitly
 * on every tenant row). Idempotent: exits 0 if the super-admin already exists.
 *
 * Pseudo-random data is deterministic (mulberry32, fixed seed) relative to the
 * run date: re-seeding after a reset on the same day produces identical data.
 */
import {
  AppointmentStatus,
  Gender,
  InvoiceStatus,
  LabOrderStatus,
  PaymentMethod,
  Prisma,
  PrismaClient,
  ResultFlag,
  TicketStatus,
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
import { PACKAGE_DEFS, SERVICE_DEFS, DRUGS, type CategoryKey } from './seed-data/services';
import { NOTIFICATION_TEMPLATE_DEFS } from './seed-data/templates';

const prisma = new PrismaClient();

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
const rand = mulberry32(20260718);
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

// ============================================================ Asia/Tashkent (+05:00) date helpers
const HOUR = 3_600_000;
const TK_OFFSET_H = 5;
const nowTk = new Date(Date.now() + TK_OFFSET_H * HOUR); // read Tashkent wall clock via getUTC*
const TODAY = { y: nowTk.getUTCFullYear(), m: nowTk.getUTCMonth(), d: nowTk.getUTCDate() };
/** Tashkent wall-clock -> UTC instant. */
const tk = (y: number, m: number, d: number, hh = 0, mi = 0) =>
  new Date(Date.UTC(y, m, d, hh, mi) - TK_OFFSET_H * HOUR);
const tkDay = (offsetDays: number, hh = 0, mi = 0) => tk(TODAY.y, TODAY.m, TODAY.d + offsetDays, hh, mi);
/** UTC-midnight Date for the Tashkent calendar day (for @db.Date columns). */
const dateOnly = (offsetDays: number) => new Date(Date.UTC(TODAY.y, TODAY.m, TODAY.d + offsetDays));
const isoWeekday = (offsetDays: number) => {
  const wd = dateOnly(offsetDays).getUTCDay();
  return wd === 0 ? 7 : wd;
};
/** Tashkent day index (days since epoch) of a UTC instant — for shift matching. */
const tkDayIndex = (d: Date) => Math.floor((d.getTime() + TK_OFFSET_H * HOUR) / 86_400_000);
const addMin = (d: Date, min: number) => new Date(d.getTime() + min * 60_000);

const money = (n: number) => n.toFixed(2);
const uuid = () => randomUUID();

// ============================================================ clinic configuration
interface DoctorCfg {
  key: 'kardiolog' | 'pediatr' | 'nevrolog' | 'utt';
  fullName: string;
  email: string;
  specialty: string;
  slotMinutes: number;
  branchIdx: number;
  roomNumber: string;
  primaryServiceCodes: string[];
  extraServiceCodes: string[];
}

interface ClinicCfg {
  key: string;
  name: string;
  legalName: string;
  planCode: string;
  domain: string;
  phone: string;
  email: string;
  address: string;
  staffPhoneBase: string; // 6-digit suffix appended: +998901 00000X
  branches: { name: string; address: string; phone: string }[];
  owner: string;
  admin: string;
  doctors: DoctorCfg[];
  receptionists: string[];
  cashier: string;
  labTech: string;
}

const CLINIC_CFGS: ClinicCfg[] = [
  {
    key: 'shifomed',
    name: 'Shifo Med Servis',
    legalName: '"SHIFO MED SERVIS" MChJ',
    planCode: 'standard',
    domain: 'shifomed.uz',
    phone: '+998712001122',
    email: 'info@shifomed.uz',
    address: "Toshkent sh., Chilonzor tumani, Bunyodkor shoh ko'chasi 12",
    staffPhoneBase: '+998901',
    branches: [
      {
        name: 'Markaziy filial',
        address: "Toshkent sh., Chilonzor tumani, Bunyodkor shoh ko'chasi 12",
        phone: '+998712001122',
      },
      {
        name: 'Yunusobod filiali',
        address: "Toshkent sh., Yunusobod tumani, Amir Temur shoh ko'chasi 108",
        phone: '+998712003344',
      },
    ],
    owner: 'Anvar Karimov',
    admin: 'Dilfuza Rashidova',
    doctors: [
      { key: 'kardiolog', fullName: 'Botir Yusupov', email: 'kardiolog', specialty: 'kardiolog', slotMinutes: 20, branchIdx: 0, roomNumber: '101', primaryServiceCodes: ['SVC-001'], extraServiceCodes: ['SVC-029', 'SVC-024', 'SVC-009', 'SVC-008'] },
      { key: 'pediatr', fullName: 'Malika Azimova', email: 'pediatr', specialty: 'pediatr', slotMinutes: 15, branchIdx: 0, roomNumber: '102', primaryServiceCodes: ['SVC-002'], extraServiceCodes: ['SVC-006', 'SVC-018', 'SVC-016'] },
      { key: 'nevrolog', fullName: 'Sherzod Mirzayev', email: 'nevrolog', specialty: 'nevrolog', slotMinutes: 15, branchIdx: 1, roomNumber: '101', primaryServiceCodes: ['SVC-003'], extraServiceCodes: ['SVC-026', 'SVC-028', 'SVC-006'] },
      { key: 'utt', fullName: 'Nilufar Sattorova', email: 'utt', specialty: 'UTT (ultratovush)', slotMinutes: 30, branchIdx: 1, roomNumber: '103', primaryServiceCodes: ['SVC-021', 'SVC-022', 'SVC-023', 'SVC-025'], extraServiceCodes: ['SVC-024'] },
    ],
    receptionists: ['Madina Tursunova', 'Aziza Nazarova'],
    cashier: 'Kamola Rahimova',
    labTech: 'Jasur Xolmatov',
  },
  {
    key: 'nur',
    name: 'Nur Klinika',
    legalName: '"NUR KLINIKA" MChJ',
    planCode: 'starter',
    domain: 'nurklinika.uz',
    phone: '+998712505060',
    email: 'info@nurklinika.uz',
    address: "Toshkent sh., Mirobod tumani, Afrosiyob ko'chasi 4",
    staffPhoneBase: '+998902',
    branches: [
      {
        name: 'Asosiy filial',
        address: "Toshkent sh., Mirobod tumani, Afrosiyob ko'chasi 4",
        phone: '+998712505060',
      },
    ],
    owner: 'Bahodir Aliyev',
    admin: 'Gulnora Ismoilova',
    doctors: [
      { key: 'kardiolog', fullName: 'Rustam Qodirov', email: 'kardiolog', specialty: 'kardiolog', slotMinutes: 20, branchIdx: 0, roomNumber: '101', primaryServiceCodes: ['SVC-001'], extraServiceCodes: ['SVC-029', 'SVC-024', 'SVC-009'] },
      { key: 'pediatr', fullName: 'Sevara Yusupova', email: 'pediatr', specialty: 'pediatr', slotMinutes: 15, branchIdx: 0, roomNumber: '102', primaryServiceCodes: ['SVC-002'], extraServiceCodes: ['SVC-006', 'SVC-018'] },
      { key: 'nevrolog', fullName: 'Otabek Ergashev', email: 'nevrolog', specialty: 'nevrolog', slotMinutes: 15, branchIdx: 0, roomNumber: '104', primaryServiceCodes: ['SVC-003'], extraServiceCodes: ['SVC-026', 'SVC-028'] },
      { key: 'utt', fullName: 'Zarina Hakimova', email: 'utt', specialty: 'UTT (ultratovush)', slotMinutes: 30, branchIdx: 0, roomNumber: '103', primaryServiceCodes: ['SVC-021', 'SVC-022', 'SVC-023', 'SVC-025'], extraServiceCodes: ['SVC-024'] },
    ],
    receptionists: ['Nargiza Karimova', 'Feruza Olimova'],
    cashier: 'Dildora Sodiqova',
    labTech: 'Laziz Normatov',
  },
];

const WORKING_HOURS = [
  { weekday: 1, open: '09:00', close: '18:00' },
  { weekday: 2, open: '09:00', close: '18:00' },
  { weekday: 3, open: '09:00', close: '18:00' },
  { weekday: 4, open: '09:00', close: '18:00' },
  { weekday: 5, open: '09:00', close: '18:00' },
  { weekday: 6, open: '09:00', close: '14:00' },
  { weekday: 7, closed: true },
];

const CLINIC_SETTINGS = {
  invoiceNumberFormat: 'INV-{YYYY}-{NNNNNN}',
  vatRate: 0,
  visitLockHours: 24,
  doctorPatientAccess: 'branch',
  onlineBookingEnabled: true,
};

const ROOM_DEFS: { number: string; name: string; type: 'CONSULTATION' | 'ULTRASOUND' | 'PROCEDURE' | 'LAB' }[] = [
  { number: '101', name: 'Konsultatsiya xonasi 1', type: 'CONSULTATION' },
  { number: '102', name: 'Konsultatsiya xonasi 2', type: 'CONSULTATION' },
  { number: '103', name: 'UTT xonasi', type: 'ULTRASOUND' },
  { number: '104', name: 'Muolaja xonasi', type: 'PROCEDURE' },
  { number: '105', name: 'Laboratoriya', type: 'LAB' },
];

const PATIENT_SOURCES = [
  'friend_referral', 'doctor_referral', 'instagram', 'telegram', 'facebook',
  'google', 'street_banner', 'returning', 'other',
] as const;

const SUBJECTIVE_POOL = [
  "Bosh og'rig'i va umumiy holsizlikka shikoyat qilmoqda.",
  "2 kundan beri yo'tal, tumov va isitma bezovta qilmoqda.",
  "Qorin sohasidagi og'riq va ko'ngil aynishidan shikoyat qilmoqda.",
  'Yurak sohasida sanchuvchi og\'riq, hansirash bezovta qilmoqda.',
  'Bel sohasida og\'riq, harakatlanish cheklangan.',
  'Uyqu buzilishi va tez charchashdan shikoyat qilmoqda.',
  'Bosh aylanishi va quloq shang\'illashi bezovta qilmoqda.',
  'Tomoq og\'rig\'i va yutishda qiyinchilikka shikoyat qilmoqda.',
];
const OBJECTIVE_POOL = [
  'Umumiy ahvoli qoniqarli. Teri qoplamlari toza, oddiy rangda.',
  'Tomoq shilliq qavati giperemiyalangan, tonzillalar kattalashgan.',
  'Yurak tonlari ritmik, patologik shovqinlar eshitilmaydi.',
  "Qorin yumshoq, palpatsiyada epigastral sohada yengil og'riq.",
  "O'pkada vezikulyar nafas, xirillashlar yo'q.",
  'Umurtqa pog\'onasi bel qismida palpatsiyada og\'riq, mushaklar taranglashgan.',
];
const PLAN_POOL = [
  "Dori-darmon tayinlandi, 7 kundan so'ng nazorat ko'rigi.",
  'Laboratoriya tekshiruvi va parhez tavsiya etildi.',
  "Muolajalar kursi tayinlandi, holat nazoratda.",
  "Rejim, suyuqlik ichish va dam olish tavsiya etildi.",
  "UTT tekshiruvi o'tkazildi, natijaga ko'ra davolash davom ettiriladi.",
];
const ASSESSMENT_POOL = [
  'Ahvoli qoniqarli, ambulator davolash tavsiya etildi.',
  'Kasallikning yengil kechishi, asoratsiz.',
  "O'rtacha og'irlikdagi kechish, nazorat talab etiladi.",
  'Surunkali kasallikning qo\'zg\'alish davri.',
];
const FEEDBACK_COMMENTS = [
  "Shifokor juda e'tiborli bo'ldi, rahmat!",
  "Navbat tez o'tdi, xizmat darajasi yaxshi.",
  'Klinika toza va ozoda ekan, yoqdi.',
  'Qabul biroz kechikdi, lekin shifokor yaxshi.',
  'Hammasi yoqdi, do\'stlarimga tavsiya qilaman.',
  'Narxlar biroz qimmat ekan.',
  'Laboratoriya natijalari tez chiqdi.',
  'Qabulxona xodimlari juda muloyim.',
];
const FREQ_POOL = ['kuniga 1 mahal', 'kuniga 2 mahal', 'kuniga 3 mahal'];
const INSTR_POOL = ['Ovqatdan keyin', 'Ovqatdan oldin', 'Ovqat bilan birga', 'Uxlashdan oldin'];

// phone uniqueness across all generated patients
const usedPhones = new Set<string>();
function patientPhone(): string {
  const ops = ['90', '91', '93', '94', '97', '99'];
  for (;;) {
    const p = `+998${pick(ops)}${String(randInt(1_000_000, 9_999_999))}`;
    if (!usedPhones.has(p)) {
      usedPhones.add(p);
      return p;
    }
  }
}

interface StaffCtx {
  ownerId: string;
  adminId: string;
  doctorIds: Record<string, string>; // by DoctorCfg.key
  receptionistIds: string[];
  cashierId: string;
  labTechId: string;
}

interface ApptRec {
  id: string;
  branchId: string;
  doctorKey: string;
  doctorId: string;
  patientId: string;
  startAt: Date;
  endAt: Date;
  status: AppointmentStatus;
  serviceCodes: string[];
  dayOffset: number;
  slotMinutes: number;
}

interface PatientRec {
  id: string;
  gender: Gender;
  fullName: string;
}

async function seedClinic(
  cfg: ClinicCfg,
  planId: string,
  demoHash: string,
  icdIdByCode: Map<string, string>,
  drugRows: { id: string; name: string; strength: string | null }[],
  loginRows: { clinic: string; role: string; email: string; phone: string; password: string }[],
) {
  console.log(`\n=== Clinic: ${cfg.name} ===`);

  // ---- clinic + subscription + branches + rooms -------------------------
  const clinic = await prisma.clinic.create({
    data: {
      name: cfg.name,
      legalName: cfg.legalName,
      taxId: String(randInt(300_000_000, 309_999_999)),
      phone: cfg.phone,
      email: cfg.email,
      address: cfg.address,
      defaultLocale: 'uz',
      smsSenderName: cfg.name.toUpperCase().replace(/\s+/g, '').slice(0, 11),
      status: 'ACTIVE',
      settings: CLINIC_SETTINGS,
    },
  });
  const clinicId = clinic.id;

  await prisma.clinicSubscription.create({
    data: {
      clinicId,
      planId,
      status: 'ACTIVE',
      startsAt: tkDay(-60),
      endsAt: tkDay(305),
    },
  });

  const branchIds: string[] = [];
  const roomIdByKey = new Map<string, string>(); // `${branchIdx}:${number}`
  for (let bi = 0; bi < cfg.branches.length; bi++) {
    const b = cfg.branches[bi];
    const branch = await prisma.branch.create({
      data: {
        clinicId,
        name: b.name,
        address: b.address,
        phone: b.phone,
        workingHours: WORKING_HOURS,
      },
    });
    branchIds.push(branch.id);
    for (const r of ROOM_DEFS) {
      const room = await prisma.room.create({
        data: { clinicId, branchId: branch.id, number: r.number, name: r.name, type: r.type },
      });
      roomIdByKey.set(`${bi}:${r.number}`, room.id);
    }
  }
  console.log(`  branches: ${branchIds.length}, rooms: ${branchIds.length * ROOM_DEFS.length}`);

  // ---- staff ------------------------------------------------------------
  let phoneSeq = 0;
  const nextStaffPhone = () => `${cfg.staffPhoneBase}${String(++phoneSeq).padStart(6, '0')}`;

  async function createUser(
    role: 'CLINIC_OWNER' | 'CLINIC_ADMIN' | 'DOCTOR' | 'RECEPTIONIST' | 'CASHIER' | 'LAB_TECH',
    fullName: string,
    emailLocal: string,
    branchIdxs: number[],
  ): Promise<string> {
    const email = `${emailLocal}@${cfg.domain}`;
    const phone = nextStaffPhone();
    const user = await prisma.user.create({
      data: { clinicId, phone, email, passwordHash: demoHash, fullName, role, locale: 'uz' },
    });
    await prisma.userBranch.createMany({
      data: branchIdxs.map((bi) => ({ clinicId, userId: user.id, branchId: branchIds[bi] })),
    });
    loginRows.push({ clinic: cfg.name, role, email, phone, password: 'Demo123!' });
    return user.id;
  }

  const allBranchIdxs = branchIds.map((_, i) => i);
  const staff: StaffCtx = {
    ownerId: await createUser('CLINIC_OWNER', cfg.owner, 'owner', allBranchIdxs),
    adminId: await createUser('CLINIC_ADMIN', cfg.admin, 'admin', allBranchIdxs),
    doctorIds: {},
    receptionistIds: [],
    cashierId: '',
    labTechId: '',
  };

  for (const doc of cfg.doctors) {
    const id = await createUser('DOCTOR', doc.fullName, doc.email, [doc.branchIdx]);
    staff.doctorIds[doc.key] = id;
    await prisma.staffProfile.create({
      data: {
        clinicId,
        userId: id,
        specialty: doc.specialty,
        licenseNo: `LIC-${randInt(2015, 2024)}-${String(randInt(1, 99999)).padStart(5, '0')}`,
        hireDate: tkDay(-randInt(200, 900)),
        slotMinutes: doc.slotMinutes,
        bio: `${doc.specialty} — ${randInt(5, 20)} yillik tajriba`,
      },
    });
    // Weekly schedule Mon-Fri, two windows per day
    await prisma.doctorSchedule.createMany({
      data: [1, 2, 3, 4, 5].flatMap((weekday) => [
        { clinicId, branchId: branchIds[doc.branchIdx], doctorUserId: id, weekday, startTime: '09:00', endTime: '13:00', slotMinutes: doc.slotMinutes },
        { clinicId, branchId: branchIds[doc.branchIdx], doctorUserId: id, weekday, startTime: '14:00', endTime: '18:00', slotMinutes: doc.slotMinutes },
      ]),
    });
  }

  for (let i = 0; i < cfg.receptionists.length; i++) {
    const branchIdx = Math.min(i, branchIds.length - 1);
    staff.receptionistIds.push(await createUser('RECEPTIONIST', cfg.receptionists[i], `qabul${i + 1}`, [branchIdx]));
  }
  staff.cashierId = await createUser('CASHIER', cfg.cashier, 'kassir', allBranchIdxs);
  staff.labTechId = await createUser('LAB_TECH', cfg.labTech, 'labor', [0]);
  console.log('  staff: 10 users (owner, admin, 4 doctors, 2 receptionists, cashier, lab tech)');

  // ---- service catalog --------------------------------------------------
  const categoryIdByKind = new Map<CategoryKey, string>();
  const categoryDefs: { name: string; kind: CategoryKey; sortOrder: number }[] = [
    { name: 'Konsultatsiya', kind: 'CONSULTATION', sortOrder: 1 },
    { name: 'Laboratoriya', kind: 'LAB', sortOrder: 2 },
    { name: 'UTT', kind: 'ULTRASOUND', sortOrder: 3 },
    { name: 'Muolajalar', kind: 'PROCEDURE', sortOrder: 4 },
  ];
  for (const c of categoryDefs) {
    const cat = await prisma.serviceCategory.create({
      data: { clinicId, name: c.name, kind: c.kind, sortOrder: c.sortOrder },
    });
    categoryIdByKind.set(c.kind, cat.id);
  }

  const serviceByCode = new Map<string, { id: string; price: number; name: { uz: string; ru: string } }>();
  const serviceRows: Prisma.ServiceCreateManyInput[] = [];
  for (const s of SERVICE_DEFS) {
    const id = uuid();
    serviceByCode.set(s.code, { id, price: s.price, name: { uz: s.uz, ru: s.ru } });
    serviceRows.push({
      id,
      clinicId,
      categoryId: categoryIdByKind.get(s.category)!,
      code: s.code,
      name: { uz: s.uz, ru: s.ru },
      durationMin: s.durationMin,
    });
  }
  await prisma.service.createMany({ data: serviceRows });
  await prisma.servicePrice.createMany({
    data: SERVICE_DEFS.map((s) => ({
      clinicId,
      serviceId: serviceByCode.get(s.code)!.id,
      branchId: null,
      price: money(s.price),
      effectiveFrom: tkDay(-90),
    })),
  });

  for (const p of PACKAGE_DEFS) {
    await prisma.servicePackage.create({
      data: {
        clinicId,
        code: p.code,
        name: { uz: p.uz, ru: p.ru },
        price: money(p.price),
        items: {
          create: p.serviceCodes.map((code) => ({
            clinicId,
            serviceId: serviceByCode.get(code)!.id,
            quantity: 1,
          })),
        },
      },
    });
  }
  console.log(`  services: ${SERVICE_DEFS.length} (+prices), packages: ${PACKAGE_DEFS.length}`);

  // ---- lab tests --------------------------------------------------------
  // paramRecs used later for lab order result generation
  const labTests: {
    id: string;
    code: string;
    params: { id: string; name: string; unit: string | null; ranges: any[]; textValue?: string }[];
  }[] = [];
  for (const t of LAB_TEST_DEFS) {
    const test = await prisma.labTest.create({
      data: {
        clinicId,
        serviceId: serviceByCode.get(t.serviceCode)!.id,
        code: t.code,
        name: { uz: t.uz, ru: t.ru },
        specimenType: t.specimenType,
      },
    });
    const params: (typeof labTests)[number]['params'] = [];
    for (let pi = 0; pi < t.parameters.length; pi++) {
      const p = t.parameters[pi];
      const param = await prisma.labTestParameter.create({
        data: {
          clinicId,
          labTestId: test.id,
          name: p.name,
          unit: p.unit,
          referenceRanges: p.ranges,
          sortOrder: pi,
        },
      });
      params.push({ id: param.id, name: p.name, unit: p.unit, ranges: p.ranges, textValue: p.textValue });
    }
    labTests.push({ id: test.id, code: t.code, params });
  }
  console.log(`  lab tests: ${labTests.length}`);

  // ---- patients ---------------------------------------------------------
  const patients: PatientRec[] = [];
  const patientRows: Prisma.PatientCreateManyInput[] = [];
  for (let i = 0; i < 50; i++) {
    const id = uuid();
    const gender: Gender = i % 2 === 0 ? 'MALE' : 'FEMALE';
    const firstName = gender === 'MALE' ? pick(MALE_FIRST_NAMES) : pick(FEMALE_FIRST_NAMES);
    const last = pick(LAST_NAMES);
    const lastName = gender === 'MALE' ? last : `${last}a`;
    const middleName = `${pick(MALE_FIRST_NAMES)} ${gender === 'MALE' ? "o'g'li" : 'qizi'}`;
    const fullName = `${lastName} ${firstName} ${middleName}`;
    const dobYear = randInt(1950, 2020);
    const tags: string[] = i < 3 ? ['VIP'] : i < 5 ? ['DEBTOR'] : [];
    const deposit = i >= 5 && i <= 7 ? [100_000, 200_000, 300_000][i - 5] : 0;
    patients.push({ id, gender, fullName });
    patientRows.push({
      id,
      clinicId,
      mrn: `P-${String(i + 1).padStart(6, '0')}`,
      firstName,
      lastName,
      middleName,
      fullName,
      dob: new Date(Date.UTC(dobYear, randInt(0, 11), randInt(1, 28))),
      gender,
      phone: patientPhone(),
      address: `Toshkent sh., ${pick(TASHKENT_STREETS).replace('Toshkent sh., ', '')}, ${randInt(1, 120)}-uy`,
      bloodGroup: pick(['A_POS', 'B_POS', 'O_POS', 'AB_POS', 'A_NEG', 'O_NEG', 'UNKNOWN'] as const),
      allergies: chance(0.2) ? [pick(ALLERGY_POOL)] : [],
      chronicConditions: chance(0.15) ? [pick(CHRONIC_POOL)] : [],
      source: pick(PATIENT_SOURCES),
      tags,
      balance: money(deposit),
      createdAt: tkDay(-randInt(0, 180), randInt(9, 17), randInt(0, 59)),
    });
  }
  await prisma.patient.createMany({ data: patientRows });
  await prisma.patientBalanceTransaction.createMany({
    data: [5, 6, 7].map((i) => ({
      clinicId,
      patientId: patients[i].id,
      type: 'DEPOSIT' as const,
      amount: money([100_000, 200_000, 300_000][i - 5]),
      note: "Avans to'lovi (depozit)",
      createdById: staff.cashierId,
      createdAt: tkDay(-randInt(3, 20), 11, 0),
    })),
  });
  console.log(`  patients: ${patients.length} (3 VIP, 2 DEBTOR, 3 with deposits)`);

  // ---- appointments (±7 days, weekdays, within schedules) ---------------
  const appts: ApptRec[] = [];
  const apptRows: Prisma.AppointmentCreateManyInput[] = [];
  const nowUtc = new Date();
  for (const doc of cfg.doctors) {
    const doctorId = staff.doctorIds[doc.key];
    const branchId = branchIds[doc.branchIdx];
    const roomId = roomIdByKey.get(`${doc.branchIdx}:${doc.roomNumber}`) ?? null;
    const slot = doc.slotMinutes;
    const allSlots: number[] = [];
    for (const [w0, w1] of [[9 * 60, 13 * 60], [14 * 60, 18 * 60]]) {
      for (let m = w0; m + slot <= w1; m += slot) allSlots.push(m);
    }
    for (let off = -7; off <= 7; off++) {
      if (isoWeekday(off) > 5) continue;
      const chosen = shuffle(allSlots).slice(0, 8).sort((a, b) => a - b);
      const dayPatients = shuffle(patients).slice(0, chosen.length);
      for (let k = 0; k < chosen.length; k++) {
        const startAt = tkDay(off, Math.floor(chosen[k] / 60), chosen[k] % 60);
        const endAt = addMin(startAt, slot);
        let status: AppointmentStatus;
        if (off < 0) status = chance(0.08) ? 'NO_SHOW' : 'COMPLETED';
        else if (off === 0)
          status = startAt < nowUtc ? (chance(0.5) ? 'CHECKED_IN' : 'CONFIRMED') : chance(0.5) ? 'SCHEDULED' : 'CONFIRMED';
        else status = chance(0.5) ? 'SCHEDULED' : 'CONFIRMED';
        const serviceCodes = [pick(doc.primaryServiceCodes)];
        if (chance(0.3)) serviceCodes.push(pick(doc.extraServiceCodes));
        const rec: ApptRec = {
          id: uuid(), branchId, doctorKey: doc.key, doctorId, patientId: dayPatients[k].id,
          startAt, endAt, status, serviceCodes, dayOffset: off, slotMinutes: slot,
        };
        appts.push(rec);
        apptRows.push({
          id: rec.id, clinicId, branchId, patientId: rec.patientId, doctorUserId: doctorId,
          roomId, startAt, endAt, status, createdById: staff.receptionistIds[0],
          createdAt: addMin(startAt, -randInt(60, 4320)),
        });
      }
    }
  }
  await prisma.appointment.createMany({ data: apptRows });
  await prisma.appointmentService.createMany({
    data: appts.flatMap((a) =>
      a.serviceCodes.map((code) => ({
        clinicId,
        appointmentId: a.id,
        serviceId: serviceByCode.get(code)!.id,
      })),
    ),
  });
  console.log(`  appointments: ${appts.length} (services: ${appts.reduce((s, a) => s + a.serviceCodes.length, 0)})`);

  // ---- cashier shifts (before payments, so payments can link) -----------
  const closedShiftByBranch = new Map<string, string>();
  for (const branchId of branchIds) {
    const shift = await prisma.cashierShift.create({
      data: {
        clinicId, branchId, cashierUserId: staff.cashierId, status: 'CLOSED',
        openedAt: tkDay(-1, 8, 30), closedAt: tkDay(-1, 18, 30), openingCash: money(200_000),
      },
    });
    closedShiftByBranch.set(branchId, shift.id);
  }
  const openShift = await prisma.cashierShift.create({
    data: {
      clinicId, branchId: branchIds[0], cashierUserId: staff.cashierId, status: 'OPEN',
      openedAt: tkDay(0, 8, 30), openingCash: money(200_000),
    },
  });

  // ---- visits (60% of past COMPLETED) + EHR -----------------------------
  interface VisitRec { id: string; appt: ApptRec; startedAt: Date; completedAt: Date }
  const visits: VisitRec[] = [];
  const visitRows: Prisma.VisitCreateManyInput[] = [];
  const vitalRows: Prisma.VisitVitalCreateManyInput[] = [];
  const diagRows: Prisma.DiagnosisCreateManyInput[] = [];
  const rxRows: Prisma.PrescriptionCreateManyInput[] = [];
  const icdCodes = ICD10_CODES.map(([code]) => code);
  for (const a of appts) {
    if (a.dayOffset >= 0 || a.status !== 'COMPLETED' || !chance(0.6)) continue;
    const id = uuid();
    const startedAt = addMin(a.startAt, randInt(1, 5));
    const completedAt = addMin(startedAt, randInt(Math.max(5, a.slotMinutes - 5), a.slotMinutes));
    visits.push({ id, appt: a, startedAt, completedAt });
    visitRows.push({
      id, clinicId, branchId: a.branchId, patientId: a.patientId, doctorUserId: a.doctorId,
      appointmentId: a.id, status: 'COMPLETED',
      subjective: pick(SUBJECTIVE_POOL), objective: pick(OBJECTIVE_POOL),
      assessmentNote: pick(ASSESSMENT_POOL), plan: pick(PLAN_POOL),
      startedAt, completedAt, lockedAt: addMin(completedAt, 24 * 60),
      nextVisitAt: chance(0.25) ? addMin(a.startAt, 7 * 24 * 60) : null,
    });
    vitalRows.push({
      clinicId, visitId: id,
      heightCm: randInt(150, 190), weightKg: randInt(48, 105),
      bpSystolic: randInt(105, 155), bpDiastolic: randInt(65, 95),
      pulseBpm: randInt(58, 96), temperatureC: Math.round((36.3 + rand() * 1.5) * 10) / 10,
      spo2: randInt(95, 99), recordedById: a.doctorId, recordedAt: startedAt,
    });
    const nDiag = randInt(1, 2);
    const codes = shuffle(icdCodes).slice(0, nDiag);
    codes.forEach((code, ci) =>
      diagRows.push({ clinicId, visitId: id, icd10Id: icdIdByCode.get(code)!, isPrimary: ci === 0, createdAt: completedAt }),
    );
    const nRx = randInt(1, 2);
    for (let r = 0; r < nRx; r++) {
      const drug = pick(drugRows);
      rxRows.push({
        clinicId, visitId: id, drugName: drug.name, drugId: drug.id, dosage: drug.strength,
        frequency: pick(FREQ_POOL), durationDays: randInt(5, 10), instructions: pick(INSTR_POOL),
        createdAt: completedAt,
      });
    }
  }
  await prisma.visit.createMany({ data: visitRows });
  await prisma.visitVital.createMany({ data: vitalRows });
  await prisma.diagnosis.createMany({ data: diagRows });
  await prisma.prescription.createMany({ data: rxRows });
  console.log(`  visits: ${visits.length} (vitals ${vitalRows.length}, diagnoses ${diagRows.length}, prescriptions ${rxRows.length})`);

  // ---- invoices & payments ---------------------------------------------
  let invSeq = 0;
  const nextInvNumber = (year: number) => `INV-${year}-${String(++invSeq).padStart(6, '0')}`;
  const invoiceRows: Prisma.InvoiceCreateManyInput[] = [];
  const lineRows: Prisma.InvoiceLineCreateManyInput[] = [];
  const paymentRows: Prisma.PaymentCreateManyInput[] = [];
  const cashByShift = new Map<string, number>();

  const pickMethod = (): PaymentMethod => {
    const r = rand();
    return r < 0.6 ? 'CASH' : r < 0.85 ? 'CARD' : r < 0.95 ? 'PAYME' : 'CLICK';
  };
  const addPayment = (invoiceId: string, branchId: string, amount: number, paidAt: Date) => {
    const method = pickMethod();
    let shiftId: string | null = null;
    if (tkDayIndex(paidAt) === tkDayIndex(tkDay(-1, 12, 0))) shiftId = closedShiftByBranch.get(branchId) ?? null;
    else if (tkDayIndex(paidAt) === tkDayIndex(tkDay(0, 12, 0)) && branchId === branchIds[0]) shiftId = openShift.id;
    if (shiftId && method === 'CASH') cashByShift.set(shiftId, (cashByShift.get(shiftId) ?? 0) + amount);
    paymentRows.push({
      clinicId, branchId, invoiceId, amount: money(amount), method, status: 'COMPLETED',
      shiftId, receivedById: staff.cashierId, paidAt, createdAt: paidAt,
    });
    return method;
  };

  // 30-day payment history (feeds revenue charts): standalone paid invoices
  for (let i = 0; i < 40; i++) {
    const id = uuid();
    const issuedAt = tkDay(-randInt(8, 30), randInt(9, 17), pick([0, 15, 30, 45] as const));
    const branchId = pick(branchIds);
    const patient = pick(patients);
    const codes = shuffle(SERVICE_DEFS).slice(0, randInt(1, 2)).map((s) => s.code);
    let subtotal = 0;
    for (const code of codes) {
      const svc = serviceByCode.get(code)!;
      subtotal += svc.price;
      lineRows.push({
        clinicId, invoiceId: id, serviceId: svc.id, title: svc.name, quantity: 1,
        unitPrice: money(svc.price), lineTotal: money(svc.price),
        performerUserId: chance(0.5) ? pick(Object.values(staff.doctorIds)) : null,
      });
    }
    invoiceRows.push({
      id, clinicId, branchId, number: nextInvNumber(issuedAt.getUTCFullYear()), patientId: patient.id,
      status: 'PAID', subtotal: money(subtotal), total: money(subtotal), paidTotal: money(subtotal),
      issuedAt, createdById: staff.receptionistIds[0], createdAt: issuedAt,
    });
    addPayment(id, branchId, subtotal, addMin(issuedAt, randInt(5, 40)));
  }

  // invoices for completed visits (last 7 days); 3 partially paid, rest paid
  let partialCount = 0;
  const sortedVisits = [...visits].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  for (let vi = 0; vi < sortedVisits.length; vi++) {
    const v = sortedVisits[vi];
    const id = uuid();
    const issuedAt = addMin(v.completedAt, randInt(2, 10));
    let subtotal = 0;
    for (const code of v.appt.serviceCodes) {
      const svc = serviceByCode.get(code)!;
      subtotal += svc.price;
      lineRows.push({
        clinicId, invoiceId: id, serviceId: svc.id, title: svc.name, quantity: 1,
        unitPrice: money(svc.price), lineTotal: money(svc.price), performerUserId: v.appt.doctorId,
      });
    }
    const makePartial = partialCount < 3 && vi % 17 === 5;
    let status: InvoiceStatus = 'PAID';
    let paid = subtotal;
    if (makePartial) {
      partialCount++;
      status = 'PARTIALLY_PAID';
      paid = Math.round((subtotal * (0.4 + rand() * 0.3)) / 1000) * 1000;
    }
    invoiceRows.push({
      id, clinicId, branchId: v.appt.branchId, number: nextInvNumber(issuedAt.getUTCFullYear()),
      patientId: v.appt.patientId, visitId: v.id, status,
      subtotal: money(subtotal), total: money(subtotal), paidTotal: money(paid),
      issuedAt, createdById: staff.receptionistIds[0], createdAt: issuedAt,
    });
    addPayment(id, v.appt.branchId, paid, addMin(issuedAt, randInt(5, 45)));
  }

  // 2 draft invoices
  for (let i = 0; i < 2; i++) {
    const id = uuid();
    const svc = serviceByCode.get(pick(SERVICE_DEFS).code)!;
    lineRows.push({
      clinicId, invoiceId: id, serviceId: svc.id, title: svc.name, quantity: 1,
      unitPrice: money(svc.price), lineTotal: money(svc.price),
    });
    invoiceRows.push({
      id, clinicId, branchId: branchIds[0], number: nextInvNumber(TODAY.y), patientId: pick(patients).id,
      status: 'DRAFT', subtotal: money(svc.price), total: money(svc.price), paidTotal: money(0),
      createdById: staff.receptionistIds[0], createdAt: tkDay(0, 9, 30 + i * 10),
    });
  }

  await prisma.invoice.createMany({ data: invoiceRows });
  await prisma.invoiceLine.createMany({ data: lineRows });
  await prisma.payment.createMany({ data: paymentRows });

  // close out yesterday's shifts with consistent cash totals
  for (const [, shiftId] of closedShiftByBranch) {
    const expected = 200_000 + (cashByShift.get(shiftId) ?? 0);
    await prisma.cashierShift.update({
      where: { id: shiftId },
      data: { expectedCash: money(expected), actualCash: money(expected) },
    });
  }
  console.log(`  invoices: ${invoiceRows.length} (${partialCount} partial, 2 draft), payments: ${paymentRows.length}`);

  // ---- lab orders -------------------------------------------------------
  const labStatuses: LabOrderStatus[] = ['ORDERED', 'IN_PROGRESS', 'RESULTED', 'APPROVED', 'APPROVED'];
  for (let i = 0; i < labStatuses.length; i++) {
    const status = labStatuses[i];
    const patient = patients[randInt(0, patients.length - 1)];
    const createdAt = tkDay(-(i % 3), 9 + i, 15);
    const order = await prisma.labOrder.create({
      data: {
        clinicId, branchId: branchIds[0], orderNumber: `L-${String(i + 1).padStart(6, '0')}`,
        patientId: patient.id, status, orderedById: pick(Object.values(staff.doctorIds)),
        collectedAt: status === 'ORDERED' ? null : addMin(createdAt, 30),
        createdAt,
      },
    });
    const tests = shuffle(labTests).slice(0, randInt(1, 3));
    for (const t of tests) {
      const item = await prisma.labOrderItem.create({
        data: { clinicId, orderId: order.id, labTestId: t.id },
      });
      if (status === 'RESULTED' || status === 'APPROVED') {
        const result = await prisma.labResult.create({
          data: {
            clinicId, orderItemId: item.id, enteredById: staff.labTechId,
            approvedById: status === 'APPROVED' ? staff.labTechId : null,
            approvedAt: status === 'APPROVED' ? addMin(createdAt, 180) : null,
          },
        });
        const valueRows: Prisma.LabResultValueCreateManyInput[] = [];
        for (const p of t.params) {
          if (p.textValue !== undefined || p.ranges.length === 0) {
            valueRows.push({ clinicId, resultId: result.id, parameterId: p.id, value: p.textValue ?? '-', flag: 'NORMAL' });
            continue;
          }
          const range = p.ranges.find((r: any) => !r.gender || r.gender === patient.gender) ?? p.ranges[0];
          let value: number;
          let flag: ResultFlag = 'NORMAL';
          const r = rand();
          if (r < 0.08) { value = range.high * (1.05 + rand() * 0.25); flag = 'HIGH'; }
          else if (r < 0.14) { value = Math.max(0, range.low * (0.6 + rand() * 0.3)); flag = 'LOW'; }
          else value = range.low + rand() * (range.high - range.low);
          const decimals = range.high - range.low < 10 ? 2 : range.high - range.low < 100 ? 1 : 0;
          valueRows.push({ clinicId, resultId: result.id, parameterId: p.id, value: value.toFixed(decimals), flag });
        }
        await prisma.labResultValue.createMany({ data: valueRows });
      }
    }
  }
  console.log(`  lab orders: ${labStatuses.length}`);

  // ---- today's live queues + tickets ------------------------------------
  const linkedApptIds: string[] = [];
  let ticketTotal = 0;
  for (let bi = 0; bi < branchIds.length; bi++) {
    const branchId = branchIds[bi];
    const branchDoctors = cfg.doctors.filter((d) => d.branchIdx === bi);
    for (let di = 0; di < branchDoctors.length; di++) {
      const doc = branchDoctors[di];
      const doctorId = staff.doctorIds[doc.key];
      const roomId = roomIdByKey.get(`${bi}:${doc.roomNumber}`) ?? null;
      const nWaiting = randInt(3, 4);
      const statuses: TicketStatus[] = [
        'DONE', 'DONE', 'DONE', 'IN_ROOM', 'CALLED',
        ...Array<TicketStatus>(nWaiting).fill('WAITING'),
      ];
      const queue = await prisma.queue.create({
        data: {
          clinicId, branchId, kind: 'DOCTOR', doctorUserId: doctorId,
          prefix: 'ABCD'[di] ?? 'A', date: dateOnly(0), lastNumber: statuses.length, isOpen: true,
        },
      });
      // today's appointments for this doctor, in order — linked to non-done tickets
      const todaysAppts = appts
        .filter((a) => a.doctorKey === doc.key && a.dayOffset === 0)
        .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
      let apptCursor = 0;
      const ticketRows: Prisma.QueueTicketCreateManyInput[] = [];
      const qBase = tkDay(0, 9, 0);
      let firstWaiting = true;
      for (let n = 0; n < statuses.length; n++) {
        const status = statuses[n];
        let appt: ApptRec | null = null;
        if (status !== 'DONE' && status !== 'IN_ROOM' && apptCursor < todaysAppts.length && chance(0.6)) {
          appt = todaysAppts[apptCursor++];
          linkedApptIds.push(appt.id);
        }
        const patientId = appt ? appt.patientId : patients[(n * 7 + di * 11 + bi * 17) % patients.length].id;
        const calledAt = status === 'DONE' ? addMin(qBase, n * 20 + 3)
          : status === 'IN_ROOM' ? addMin(qBase, 63)
          : status === 'CALLED' ? addMin(qBase, 82) : null;
        const startedAt = status === 'DONE' ? addMin(calledAt!, 2) : status === 'IN_ROOM' ? addMin(calledAt!, 2) : null;
        const finishedAt = status === 'DONE' ? addMin(startedAt!, randInt(10, 16)) : null;
        let priority: 'NORMAL' | 'PRIORITY' = 'NORMAL';
        if (status === 'WAITING' && firstWaiting) { priority = 'PRIORITY'; firstWaiting = false; }
        ticketRows.push({
          clinicId, branchId, queueId: queue.id, number: n + 1, patientId,
          doctorUserId: doctorId, appointmentId: appt?.id ?? null, status, priority,
          position: n + 1, roomId, calledAt, startedAt, finishedAt,
          createdAt: addMin(qBase, -20 + n * 6),
        });
      }
      await prisma.queueTicket.createMany({ data: ticketRows });
      ticketTotal += ticketRows.length;
    }
  }
  if (linkedApptIds.length > 0) {
    await prisma.appointment.updateMany({
      where: { id: { in: linkedApptIds } },
      data: { status: 'IN_QUEUE' },
    });
  }
  console.log(`  queues: today per doctor, tickets: ${ticketTotal} (${linkedApptIds.length} linked to appointments)`);

  // ---- feedback ---------------------------------------------------------
  const fbVisits = shuffle(visits).slice(0, 15);
  await prisma.feedback.createMany({
    data: fbVisits.map((v) => {
      const rating = chance(0.7) ? 5 : chance(0.67) ? 4 : randInt(2, 3);
      return {
        clinicId, branchId: v.appt.branchId, patientId: v.appt.patientId, visitId: v.id,
        doctorUserId: v.appt.doctorId, rating,
        comment: chance(0.7) ? pick(FEEDBACK_COMMENTS) : null,
        isPublic: rating >= 4 && chance(0.5),
        createdAt: addMin(v.completedAt, randInt(60, 600)),
      };
    }),
  });

  // ---- expenses ---------------------------------------------------------
  const expenseCats: { name: string; min: number; max: number }[] = [
    { name: 'Ijara', min: 8_000_000, max: 15_000_000 },
    { name: 'Kommunal', min: 1_500_000, max: 3_000_000 },
    { name: 'Sarf materiallar', min: 300_000, max: 1_500_000 },
    { name: 'Marketing', min: 1_000_000, max: 3_000_000 },
  ];
  const expenseCatIds: { id: string; min: number; max: number; name: string }[] = [];
  for (const c of expenseCats) {
    const cat = await prisma.expenseCategory.create({ data: { clinicId, name: c.name } });
    expenseCatIds.push({ id: cat.id, ...c });
  }
  await prisma.expense.createMany({
    data: Array.from({ length: 10 }, () => {
      const cat = pick(expenseCatIds);
      return {
        clinicId, branchId: pick(branchIds), categoryId: cat.id,
        amount: money(Math.round(randInt(cat.min, cat.max) / 10_000) * 10_000),
        date: dateOnly(-randInt(1, 30)),
        note: `${cat.name} xarajati`, createdById: staff.adminId,
      };
    }),
  });
  console.log('  feedback: 15, expense categories: 4, expenses: 10');

  // ---- notification templates ------------------------------------------
  await prisma.notificationTemplate.createMany({
    data: NOTIFICATION_TEMPLATE_DEFS.map((t) => ({
      clinicId, event: t.event, channel: t.channel, locale: t.locale, body: t.body,
    })),
  });
  console.log(`  notification templates: ${NOTIFICATION_TEMPLATE_DEFS.length}`);

  // ---- counters (consistent with used sequences) ------------------------
  await prisma.clinicCounter.createMany({
    data: [
      { clinicId, key: 'mrn', value: BigInt(patients.length) },
      { clinicId, key: 'invoice', value: BigInt(invSeq) },
      { clinicId, key: 'lab', value: BigInt(labStatuses.length) },
    ],
  });

  // ---- patient visit/no-show counters -----------------------------------
  const visitCount = new Map<string, number>();
  for (const v of visits) visitCount.set(v.appt.patientId, (visitCount.get(v.appt.patientId) ?? 0) + 1);
  const noShowCount = new Map<string, number>();
  for (const a of appts) if (a.status === 'NO_SHOW') noShowCount.set(a.patientId, (noShowCount.get(a.patientId) ?? 0) + 1);
  for (const [patientId, count] of visitCount) {
    await prisma.patient.update({ where: { id: patientId }, data: { visitCount: count } });
  }
  for (const [patientId, count] of noShowCount) {
    await prisma.patient.update({ where: { id: patientId }, data: { noShowCount: count } });
  }
}

// ============================================================ main
async function main() {
  const existing = await prisma.user.findFirst({
    where: { role: 'SUPER_ADMIN', email: 'admin@avishifo.uz' },
  });
  if (existing) {
    console.log('already seeded');
    return;
  }

  if (ICD10_CODES.length !== 200) throw new Error(`ICD10_CODES must have 200 entries, got ${ICD10_CODES.length}`);
  if (DRUGS.length !== 60) throw new Error(`DRUGS must have 60 entries, got ${DRUGS.length}`);

  console.log('Seeding AviShifo demo data...');
  const [adminHash, demoHash] = await Promise.all([
    argon2.hash('Admin123!', { type: argon2.argon2id }),
    argon2.hash('Demo123!', { type: argon2.argon2id }),
  ]);

  // ---- subscription plans ----------------------------------------------
  const planDefs = [
    { code: 'starter', name: 'Starter', priceMonthly: money(990_000), maxBranches: 1, maxUsers: 10, modules: ['portal'] },
    { code: 'standard', name: 'Standard', priceMonthly: money(1_990_000), maxBranches: 3, maxUsers: 30, modules: ['lab', 'portal', 'telegram'] },
    { code: 'pro', name: 'Pro', priceMonthly: money(3_990_000), maxBranches: 10, maxUsers: 100, modules: ['lab', 'portal', 'telegram', 'analytics'] },
  ];
  const planIdByCode = new Map<string, string>();
  for (const p of planDefs) {
    const plan = await prisma.subscriptionPlan.upsert({
      where: { code: p.code },
      create: p,
      update: {},
    });
    planIdByCode.set(p.code, plan.id);
  }
  console.log(`plans: ${planDefs.length}`);

  // ---- super admin ------------------------------------------------------
  await prisma.user.create({
    data: {
      clinicId: null,
      email: 'admin@avishifo.uz',
      phone: '+998900000000',
      passwordHash: adminHash,
      fullName: 'AviShifo Super Admin',
      role: 'SUPER_ADMIN',
      locale: 'uz',
    },
  });
  console.log('super admin: admin@avishifo.uz');

  // ---- global ICD-10 directory -----------------------------------------
  if ((await prisma.icd10Code.count()) === 0) {
    await prisma.icd10Code.createMany({
      data: ICD10_CODES.map(([code, nameUz, nameRu]) => ({ code, nameUz, nameRu, chapter: code[0] })),
    });
    console.log(`icd-10 codes: ${ICD10_CODES.length}`);
  } else {
    console.log('icd-10 codes: already present, skipped');
  }
  const icdIdByCode = new Map<string, string>(
    (await prisma.icd10Code.findMany({ select: { id: true, code: true } })).map((r) => [r.code, r.id]),
  );

  // ---- global drug directory -------------------------------------------
  if ((await prisma.drugDirectory.count({ where: { clinicId: null } })) === 0) {
    await prisma.drugDirectory.createMany({
      data: DRUGS.map(([name, form, strength]) => ({ clinicId: null, name, form, strength })),
    });
    console.log(`drugs: ${DRUGS.length}`);
  } else {
    console.log('drugs: already present, skipped');
  }
  const drugRows = await prisma.drugDirectory.findMany({
    where: { clinicId: null },
    select: { id: true, name: true, strength: true },
  });

  // ---- clinics ----------------------------------------------------------
  const loginRows: { clinic: string; role: string; email: string; phone: string; password: string }[] = [
    { clinic: 'PLATFORM', role: 'SUPER_ADMIN', email: 'admin@avishifo.uz', phone: '+998900000000', password: 'Admin123!' },
  ];
  for (const cfg of CLINIC_CFGS) {
    await seedClinic(cfg, planIdByCode.get(cfg.planCode)!, demoHash, icdIdByCode, drugRows, loginRows);
  }

  // ---- demo logins ------------------------------------------------------
  console.log('\n================= DEMO LOGINS =================');
  const wide = (s: string, n: number) => s.padEnd(n);
  console.log(`${wide('CLINIC', 18)}${wide('ROLE', 15)}${wide('EMAIL', 26)}${wide('PHONE', 16)}PASSWORD`);
  for (const r of loginRows) {
    console.log(`${wide(r.clinic, 18)}${wide(r.role, 15)}${wide(r.email, 26)}${wide(r.phone, 16)}${r.password}`);
  }
  console.log('===============================================');
  console.log('\nSeed completed.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
