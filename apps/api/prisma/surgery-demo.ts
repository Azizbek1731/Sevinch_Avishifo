import type { PrismaClient, ServiceKind } from '@prisma/client';

/** Additive demo setup: leaves existing accounts, prices and patient records intact. */
export async function seedSurgeryDemo(
  prisma: PrismaClient,
  input: { clinicId: string; branchIds: string[]; domain: string; passwordHash: string },
) {
  const { clinicId, branchIds, domain, passwordHash } = input;
  const accounts = [
    {
      email: `operatsiya@${domain}`,
      fullName: 'Operatsiya xonasi',
      role: 'OPERATING_ROOM' as const,
    },
    { email: `jarroh@${domain}`, fullName: 'Demo Jarroh', role: 'DOCTOR' as const },
  ];
  for (const account of accounts) {
    const user = await prisma.user.upsert({
      where: { clinicId_email: { clinicId, email: account.email } },
      create: { clinicId, ...account, passwordHash, locale: 'uz' },
      update: {},
    });
    for (const branchId of branchIds)
      await prisma.userBranch.upsert({
        where: { userId_branchId: { userId: user.id, branchId } },
        create: { clinicId, userId: user.id, branchId },
        update: {},
      });
    if (account.role === 'DOCTOR')
      await prisma.staffProfile.upsert({
        where: { userId: user.id },
        create: { clinicId, userId: user.id, specialty: 'Jarroh' },
        update: {},
      });
  }
  const categories: Array<{ kind: ServiceKind; name: string; sortOrder: number }> = [
    { kind: 'SURGERY', name: 'Operatsiyalar', sortOrder: 5 },
    { kind: 'MATERIAL', name: 'Sarf materiallari', sortOrder: 6 },
    { kind: 'MEDICINE', name: 'Dori vositalari', sortOrder: 7 },
  ];
  const ids = new Map<ServiceKind, string>();
  for (const category of categories) {
    const row =
      (await prisma.serviceCategory.findFirst({
        where: { clinicId, kind: category.kind, isActive: true },
      })) ?? (await prisma.serviceCategory.create({ data: { clinicId, ...category } }));
    ids.set(category.kind, row.id);
  }
  const samples: Array<{
    code: string;
    kind: ServiceKind;
    name: { uz: string; 'uz-Cyrl': string; ru: string; en: string };
    unit: string;
    price: string;
  }> = [
    {
      code: 'DEMO-SUR-01',
      kind: 'SURGERY',
      name: {
        uz: 'Operatsiya — 1-tur (demo)',
        'uz-Cyrl': 'Операция — 1-тур (демо)',
        ru: 'Операция — тип 1 (демо)',
        en: 'Operation — type 1 (demo)',
      },
      unit: 'amaliyot',
      price: '1500000',
    },
    {
      code: 'DEMO-SUR-02',
      kind: 'SURGERY',
      name: {
        uz: 'Operatsiya — 2-tur (demo)',
        'uz-Cyrl': 'Операция — 2-тур (демо)',
        ru: 'Операция — тип 2 (демо)',
        en: 'Operation — type 2 (demo)',
      },
      unit: 'amaliyot',
      price: '2500000',
    },
    {
      code: 'DEMO-MAT-BINT',
      kind: 'MATERIAL',
      name: {
        uz: 'Steril bint (demo)',
        'uz-Cyrl': 'Стерил бинт (демо)',
        ru: 'Стерильный бинт (демо)',
        en: 'Sterile bandage (demo)',
      },
      unit: 'dona',
      price: '12000',
    },
    {
      code: 'DEMO-MAT-SYR',
      kind: 'MATERIAL',
      name: {
        uz: 'Bir martalik shprits (demo)',
        'uz-Cyrl': 'Бир марталик шприц (демо)',
        ru: 'Одноразовый шприц (демо)',
        en: 'Disposable syringe (demo)',
      },
      unit: 'dona',
      price: '2500',
    },
    {
      code: 'DEMO-MED-01',
      kind: 'MEDICINE',
      name: {
        uz: 'Anesteziya dori vositasi (demo)',
        'uz-Cyrl': 'Анестезия дори воситаси (демо)',
        ru: 'Препарат для анестезии (демо)',
        en: 'Anesthesia medicine (demo)',
      },
      unit: 'ampula',
      price: '45000',
    },
  ];
  for (const sample of samples) {
    const categoryId = ids.get(sample.kind)!;
    await prisma.service.upsert({
      where: { clinicId_code: { clinicId, code: sample.code } },
      update: {},
      create: {
        clinicId,
        categoryId,
        code: sample.code,
        name: sample.name,
        unit: sample.unit,
        durationMin: sample.kind === 'SURGERY' ? 60 : 1,
        prices: {
          create: { clinicId, price: sample.price, effectiveFrom: new Date('2020-01-01') },
        },
      },
    });
  }
  return accounts.map(({ email, role }) => ({ email, role }));
}
