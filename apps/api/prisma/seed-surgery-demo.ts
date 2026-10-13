import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { seedSurgeryDemo } from './surgery-demo';

config({ path: resolve(__dirname, '../../../.env') });
const prisma = new PrismaClient();
async function main() {
  const receptionist = await prisma.user.findFirst({
    where: { email: 'qabul1@shifomed.uz', role: 'RECEPTIONIST', deletedAt: null },
    include: { branches: true },
  });
  if (!receptionist?.clinicId || !receptionist.branches.length)
    throw new Error('Local ShifoMed demo clinic not found; no data changed');
  const rows = await seedSurgeryDemo(prisma, {
    clinicId: receptionist.clinicId,
    branchIds: receptionist.branches.map((b) => b.branchId),
    domain: 'shifomed.uz',
    passwordHash: await argon2.hash('Demo123!', { type: argon2.argon2id }),
  });
  console.log('Surgery demo accounts/catalogue added; existing records preserved.');
  for (const row of rows) console.log(`${row.role}: ${row.email}`);
}
void main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Setup failed');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
