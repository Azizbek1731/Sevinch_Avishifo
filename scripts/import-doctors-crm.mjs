/**
 * Imports consultation rooms + doctors (+ ko'rik services) from CRM Excel.
 * Login = password = normalized phone (+998XXXXXXXXX).
 *
 * Usage: node scripts/import-doctors-crm.mjs [path-to-xlsx]
 */
import ExcelJS from 'exceljs';
import argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const xlsxPath =
  process.argv[2] ||
  resolve(
    process.env.USERPROFILE || 'C:\\Users',
    'Администратор.WIN-JVBSUPIPLDH',
    'Downloads',
    'shifokorlar_royxati_va_korik_narxlari_crm.xlsx',
  );

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const rel of ['.env', '../.env', '../../.env']) {
    try {
      const text = readFileSync(resolve(process.cwd(), rel), 'utf8');
      const match = text.match(/^DATABASE_URL=(.*)$/m);
      if (match) return match[1].trim().replace(/^['"]|['"]$/g, '');
    } catch {
      /* try next */
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

/** "+998 91 436-74-13" → "+998914367413" */
function normalizePhone(input) {
  const digits = String(input).replace(/\D/g, '');
  let national;
  if (digits.length === 12 && digits.startsWith('998')) national = digits.slice(3);
  else if (digits.length === 9) national = digits;
  else return null;
  const normalized = `+998${national}`;
  return /^\+998\d{9}$/.test(normalized) ? normalized : null;
}

function roomNumber(raw) {
  const text = cellText(raw);
  if (!text || /biriktirilmagan|не закреплен|бириктирилмаган/i.test(text)) return null;
  return text.replace(/^№\s*/i, '').trim() || null;
}

function moneyOrNull(value) {
  const raw = cellText(value);
  if (!raw) return null;
  const n = Number(String(raw).replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) throw new Error(`Noto‘g‘ri narx: ${value}`);
  return n.toFixed(2);
}

function roomTypeForSpecialty(specialtyUz) {
  if (/uzi|узи|utt|утт/i.test(specialtyUz)) return 'ULTRASOUND';
  return 'CONSULTATION';
}

async function readDoctors(path) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.getWorksheet('CRM_Shifokorlar_3_Tilda') || wb.worksheets[0];
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const code = cellText(row.getCell(2).value);
    if (!code || /^jami/i.test(code)) return;
    const phoneRaw = cellText(row.getCell(10).value);
    const phone = normalizePhone(phoneRaw);
    if (!phone) throw new Error(`${code}: telefon noto‘g‘ri (${phoneRaw})`);
    rows.push({
      code,
      roomNumber: roomNumber(row.getCell(3).value),
      fullNameUz: cellText(row.getCell(4).value),
      fullNameRu: cellText(row.getCell(5).value),
      specialtyUz: cellText(row.getCell(7).value),
      specialtyRu: cellText(row.getCell(8).value),
      phone,
      price: moneyOrNull(row.getCell(12).value),
      noteUz: cellText(row.getCell(13).value),
      noteRu: cellText(row.getCell(14).value),
    });
  });
  return rows;
}

const prisma = new PrismaClient({ datasources: { db: { url: loadDatabaseUrl() } } });

async function ensureRoom(clinicId, branchId, number, specialtyUz) {
  const type = roomTypeForSpecialty(specialtyUz);
  const existing = await prisma.room.findFirst({ where: { branchId, number } });
  if (existing) {
    const specialties = existing.specialties.includes(specialtyUz)
      ? existing.specialties
      : [...existing.specialties, specialtyUz];
    return prisma.room.update({
      where: { id: existing.id },
      data: {
        isActive: true,
        type: existing.type === 'ULTRASOUND' || type === 'ULTRASOUND' ? 'ULTRASOUND' : existing.type,
        specialties,
        name: existing.name || `Kabinet ${number}`,
      },
    });
  }
  return prisma.room.create({
    data: {
      clinicId,
      branchId,
      number,
      name: `Kabinet ${number}`,
      type,
      specialties: [specialtyUz],
      isActive: true,
    },
  });
}

async function ensureConsultCategory(clinicId) {
  const name = "Shifokor ko'rigi";
  const existing = await prisma.serviceCategory.findFirst({
    where: { clinicId, kind: 'CONSULTATION', name },
  });
  if (existing) {
    if (!existing.isActive) {
      return prisma.serviceCategory.update({
        where: { id: existing.id },
        data: { isActive: true },
      });
    }
    return existing;
  }
  return prisma.serviceCategory.create({
    data: { clinicId, name, kind: 'CONSULTATION', sortOrder: 10, isActive: true },
  });
}

async function upsertConsultService(clinicId, categoryId, doctor) {
  const name = {
    uz: `${doctor.specialtyUz} — ${doctor.fullNameUz}`,
    ru: doctor.specialtyRu
      ? `${doctor.specialtyRu} — ${doctor.fullNameRu || doctor.fullNameUz}`
      : undefined,
  };
  const existing = await prisma.service.findFirst({
    where: { clinicId, code: doctor.code },
  });
  const now = new Date();
  let service = existing;
  if (existing) {
    service = await prisma.service.update({
      where: { id: existing.id },
      data: {
        categoryId,
        name,
        unit: "ko'rik",
        durationMin: 15,
        isActive: true,
      },
    });
  } else {
    service = await prisma.service.create({
      data: {
        clinicId,
        categoryId,
        code: doctor.code,
        name,
        unit: "ko'rik",
        durationMin: 15,
        vatIncluded: true,
        isActive: true,
      },
    });
  }

  if (doctor.price == null) {
    return { code: doctor.code, action: existing ? 'service-updated-no-price' : 'service-created-no-price' };
  }

  const current = await prisma.servicePrice.findFirst({
    where: {
      clinicId,
      serviceId: service.id,
      branchId: null,
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
    },
    orderBy: { effectiveFrom: 'desc' },
  });
  if (!current || current.price.toFixed(2) !== doctor.price) {
    if (current && current.effectiveTo == null) {
      await prisma.servicePrice.update({
        where: { id: current.id },
        data: { effectiveTo: now },
      });
    }
    await prisma.servicePrice.create({
      data: {
        clinicId,
        serviceId: service.id,
        branchId: null,
        price: doctor.price,
        effectiveFrom: now,
      },
    });
    return { code: doctor.code, action: existing ? 'service+price-updated' : 'service+price-created' };
  }
  return { code: doctor.code, action: 'service-unchanged' };
}

async function upsertDoctor(clinicId, branchId, doctor, roomIdByNumber, phoneOwner) {
  const bioParts = [doctor.noteUz, doctor.noteRu].filter(Boolean);
  const defaultRoomId = doctor.roomNumber ? roomIdByNumber.get(doctor.roomNumber) ?? null : null;

  let phone = doctor.phone;
  let email = null;
  let password = doctor.phone; // default: login = parol = telefon
  if (phoneOwner.has(phone) && phoneOwner.get(phone) !== doctor.code) {
    // Excelda takroriy telefon (DOC-16/DOC-18) — unique login telefoni (DOC-NN → +9989900000NN)
    const n = Number(String(doctor.code).replace(/\D/g, '')) || 0;
    phone = `+99899${String(n).padStart(7, '0')}`;
    password = phone;
    bioParts.unshift(`Excel telefoni band edi (${doctor.phone})`);
    console.warn(
      `WARN ${doctor.code}: Excel telefoni ${doctor.phone} band (${phoneOwner.get(doctor.phone)}) — login/parol: ${phone}`,
    );
    phoneOwner.set(phone, doctor.code);
  } else {
    phoneOwner.set(phone, doctor.code);
  }
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  const existingByCode = await prisma.user.findFirst({
    where: {
      clinicId,
      deletedAt: null,
      role: 'DOCTOR',
      OR: [
        ...(phone ? [{ phone }] : []),
        ...(email ? [{ email }] : []),
        { staffProfile: { bio: { contains: doctor.code } } },
      ],
    },
    include: { staffProfile: true, branches: true },
  });

  // Prefer match by staff bio marker or phone
  let existing =
    existingByCode ??
    (phone
      ? await prisma.user.findFirst({
          where: { clinicId, phone, deletedAt: null },
          include: { staffProfile: true, branches: true },
        })
      : null);

  // Also match by fullName + DOCTOR if phone empty path
  if (!existing) {
    existing = await prisma.user.findFirst({
      where: {
        clinicId,
        role: 'DOCTOR',
        deletedAt: null,
        fullName: doctor.fullNameUz,
      },
      include: { staffProfile: true, branches: true },
    });
  }

  const profileData = {
    specialty: doctor.specialtyUz,
    bio: [`[${doctor.code}]`, ...bioParts].join(' · ').slice(0, 500),
    slotMinutes: 15,
    defaultRoomId,
  };

  if (existing) {
    // Don't overwrite unrelated existing staff (e.g. demo doctor) unless phone/name matches our import
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        fullName: doctor.fullNameUz,
        phone,
        email,
        passwordHash,
        role: 'DOCTOR',
        status: 'ACTIVE',
        locale: 'uz',
        deletedAt: null,
      },
    });
    const hasBranch = existing.branches.some((b) => b.branchId === branchId);
    if (!hasBranch) {
      await prisma.userBranch.create({
        data: { clinicId, userId: existing.id, branchId },
      });
    }
    await prisma.staffProfile.upsert({
      where: { userId: existing.id },
      create: { clinicId, userId: existing.id, ...profileData },
      update: profileData,
    });
    return {
      code: doctor.code,
      action: 'updated',
      userId: existing.id,
      login: phone || email,
      password,
      room: doctor.roomNumber,
    };
  }

  // Phone may belong to a non-doctor / soft-deleted — clear conflict carefully
  if (phone) {
    const conflict = await prisma.user.findFirst({
      where: { clinicId, phone, deletedAt: null },
    });
    if (conflict && conflict.role !== 'DOCTOR') {
      throw new Error(
        `${doctor.code}: telefon ${phone} boshqa foydalanuvchida band (${conflict.fullName}, ${conflict.role})`,
      );
    }
  }

  const user = await prisma.user.create({
    data: {
      clinicId,
      fullName: doctor.fullNameUz,
      phone,
      email,
      passwordHash,
      role: 'DOCTOR',
      status: 'ACTIVE',
      locale: 'uz',
      branches: { create: [{ clinicId, branchId }] },
      staffProfile: { create: { clinicId, ...profileData } },
    },
  });

  return {
    code: doctor.code,
    action: 'created',
    userId: user.id,
    login: phone || email,
    password,
    room: doctor.roomNumber,
  };
}

async function main() {
  console.log('file', xlsxPath);
  const doctors = await readDoctors(xlsxPath);
  console.log('doctors', doctors.length);

  const clinic = await prisma.clinic.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!clinic) throw new Error('Klinika topilmadi');
  const branch = await prisma.branch.findFirst({
    where: { clinicId: clinic.id, isActive: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!branch) throw new Error('Filial topilmadi');
  console.log('clinic', clinic.name, 'branch', branch.name);

  // 1) Rooms first
  const roomNumbers = [...new Set(doctors.map((d) => d.roomNumber).filter(Boolean))];
  const roomIdByNumber = new Map();
  for (const number of roomNumbers) {
    const owner = doctors.find((d) => d.roomNumber === number);
    const room = await ensureRoom(clinic.id, branch.id, number, owner.specialtyUz);
    roomIdByNumber.set(number, room.id);
    console.log('room', number, room.type, room.id);
  }

  // 2) Consultation category + services
  const category = await ensureConsultCategory(clinic.id);
  console.log('category', category.name, category.id);

  // 3) Doctors (users)
  const phoneOwner = new Map();
  const results = [];
  for (const doctor of doctors) {
    const userResult = await upsertDoctor(clinic.id, branch.id, doctor, roomIdByNumber, phoneOwner);
    const serviceResult = await upsertConsultService(clinic.id, category.id, doctor);
    results.push({ ...userResult, service: serviceResult.action, price: doctor.price });
    console.log(
      userResult.action,
      doctor.code,
      doctor.fullNameUz,
      'login=',
      userResult.login,
      'room=',
      userResult.room || '—',
      serviceResult.action,
    );
  }

  const roomCount = await prisma.room.count({ where: { branchId: branch.id, isActive: true } });
  const doctorCount = await prisma.user.count({
    where: { clinicId: clinic.id, role: 'DOCTOR', deletedAt: null, status: 'ACTIVE' },
  });
  const linked = await prisma.staffProfile.count({
    where: { clinicId: clinic.id, defaultRoomId: { not: null } },
  });

  console.log(
    JSON.stringify(
      {
        roomsCreatedOrUpdated: roomNumbers.length,
        roomCount,
        doctorsProcessed: results.length,
        doctorCount,
        withDefaultRoom: linked,
        logins: results.map((r) => ({
          code: r.code,
          login: r.login,
          password: r.password,
          room: r.room,
        })),
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
