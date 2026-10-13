import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { seedPrescriptionDirectory } from './prescription-directory';

config({ path: resolve(__dirname, '../../../.env') });
const prisma = new PrismaClient();
void seedPrescriptionDirectory(prisma)
  .then((count) => console.log(`Prescription catalogue: ${count} missing entries added.`))
  .catch(() => {
    console.error(
      'Prescription catalogue setup failed. Existing clinical records were not changed.',
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
