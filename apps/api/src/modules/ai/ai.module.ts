import { Module } from '@nestjs/common';
import { AmbulatoryModule } from '../ambulatory/ambulatory.module';
import { AuthModule } from '../auth/auth.module';
import { ReportsModule } from '../reports/reports.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiToolRegistry } from './ai-tools';

/**
 * AviShifo AI. Tools wrap the same tenant-scoped report / ambulatory services
 * the panel already uses — no second data path.
 */
@Module({
  imports: [AuthModule, ReportsModule, AmbulatoryModule],
  controllers: [AiController],
  providers: [AiService, AiToolRegistry],
})
export class AiModule {}
