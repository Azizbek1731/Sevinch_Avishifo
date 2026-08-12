import { Module } from '@nestjs/common';
import { ReportsModule } from '../reports/reports.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiToolRegistry } from './ai-tools';

/**
 * AviShifo AI. Depends on ReportsModule because the assistant's tools are thin
 * wrappers over the report services that already exist — the same tenant-scoped,
 * permission-checked code the panel's own reports run on, rather than a second
 * data path that would have to be secured separately.
 */
@Module({
  imports: [ReportsModule],
  controllers: [AiController],
  providers: [AiService, AiToolRegistry],
})
export class AiModule {}
