import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createExtendedClient, type TenantPrismaClient } from './tenant-extension';

/**
 * Usage:
 *   this.prisma.db.patient.findMany(...)   // tenant-scoped (auto clinicId)
 *   this.prisma.unscoped.user.findUnique() // platform scope — justify in a comment
 *
 * Transactions: this.prisma.db.$transaction(async (tx) => { ... }) — the tenant
 * extension applies inside the transaction as well.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  /** Raw client — bypasses tenant isolation. Use only with justification. */
  readonly unscoped: PrismaClient;
  /** Tenant-scoped client — default for all module code. */
  readonly db: TenantPrismaClient;

  constructor() {
    this.unscoped = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
    this.db = createExtendedClient(this.unscoped);
  }

  async onModuleInit(): Promise<void> {
    await this.unscoped.$connect();
    this.logger.log('Prisma connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.unscoped.$disconnect();
  }
}
