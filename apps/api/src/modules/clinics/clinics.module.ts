import { Module } from '@nestjs/common';
import { ClinicsController } from './clinics.controller';
import { BranchesController } from './branches.controller';
import { ClinicsService } from './clinics.service';
import { BranchesService } from './branches.service';

/**
 * M2 — Clinic & Branch management: own-clinic profile + settings blob,
 * branches CRUD (soft delete), rooms CRUD (soft delete), TV display tokens.
 * Core providers (Prisma, Audit, Config, Jwt) are global modules.
 */
@Module({
  controllers: [ClinicsController, BranchesController],
  providers: [ClinicsService, BranchesService],
})
export class ClinicsModule {}
