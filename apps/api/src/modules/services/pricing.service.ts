import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

/**
 * Effective-dated price resolution (spec §M7).
 * A price row is "current" when effectiveFrom <= now AND (effectiveTo is null OR > now).
 * A branch override (branchId match) wins over the clinic default (branchId null).
 *
 * Exported to other modules (billing, appointments, lab) via ServicesModule.
 */
@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  /** Current price as a decimal string ("150000.00") or null when no price is set. */
  async getCurrentPrice(serviceId: string, branchId?: string): Promise<string | null> {
    const prices = await this.getCurrentPrices([serviceId], branchId);
    return prices.get(serviceId) ?? null;
  }

  /**
   * Batch variant — resolves current prices for many services in ONE query
   * (used by list endpoints to avoid N+1).
   */
  async getCurrentPrices(serviceIds: string[], branchId?: string): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (serviceIds.length === 0) return result;

    const now = new Date();
    const rows = await this.prisma.db.servicePrice.findMany({
      where: {
        serviceId: { in: serviceIds },
        effectiveFrom: { lte: now },
        AND: [
          { OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
          branchId ? { OR: [{ branchId }, { branchId: null }] } : { branchId: null },
        ],
      },
      orderBy: { effectiveFrom: 'desc' },
      select: { serviceId: true, branchId: true, price: true },
    });

    // Rows are ordered latest-first: keep the first (latest) row per bucket.
    const branchOverride = new Map<string, string>();
    const clinicDefault = new Map<string, string>();
    for (const row of rows) {
      const bucket = row.branchId ? branchOverride : clinicDefault;
      if (!bucket.has(row.serviceId)) bucket.set(row.serviceId, row.price.toFixed(2));
    }
    for (const id of serviceIds) {
      const price = branchOverride.get(id) ?? clinicDefault.get(id);
      if (price !== undefined) result.set(id, price);
    }
    return result;
  }
}
