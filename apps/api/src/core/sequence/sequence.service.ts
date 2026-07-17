import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../prisma/tenant-context';

/**
 * Per-clinic named counters (MRN, invoice numbers, lab order numbers).
 * Uses an atomic upsert+increment so concurrent calls never produce duplicates.
 */
@Injectable()
export class SequenceService {
  constructor(private readonly prisma: PrismaService) {}

  /** Returns the next value (1-based) for the clinic-scoped counter `key`. */
  async next(key: string): Promise<number> {
    const clinicId = TenantContext.requireClinicId();
    // Atomic: INSERT ... ON CONFLICT DO UPDATE SET value = value + 1 RETURNING value.
    const rows = await this.prisma.unscoped.$queryRaw<Array<{ value: bigint }>>`
      INSERT INTO "ClinicCounter" ("id", "clinicId", "key", "value")
      VALUES (gen_random_uuid(), ${clinicId}, ${key}, 1)
      ON CONFLICT ("clinicId", "key")
      DO UPDATE SET "value" = "ClinicCounter"."value" + 1
      RETURNING "value"
    `;
    return Number(rows[0]?.value ?? 1);
  }

  /** "P-000123"-style formatted counter value. */
  async nextFormatted(key: string, prefix: string, pad = 6): Promise<string> {
    const n = await this.next(key);
    return `${prefix}-${String(n).padStart(pad, '0')}`;
  }
}
