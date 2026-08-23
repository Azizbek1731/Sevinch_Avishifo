import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators';
import { ClinicsService } from './clinics.service';
import { type ClinicResponse } from './clinics.service';
import { UpdateClinicDto, UpdateClinicSettingsDto } from './dto';

@ApiTags('clinics')
@Controller('clinic')
export class ClinicsController {
  constructor(private readonly clinics: ClinicsService) {}

  /** Own clinic profile incl. active subscription plan info. Any authenticated user. */
  @Get()
  getClinic(): Promise<ClinicResponse> {
    return this.clinics.getClinic();
  }

  @Patch()
  @RequirePermissions('clinic.settings.write')
  updateClinic(@Body() dto: UpdateClinicDto): Promise<ClinicResponse> {
    return this.clinics.updateClinic(dto);
  }

  /**
   * First-run progress, read from real data. Gated by settings.read — the
   * checklist tells owners what to set up, not reception what is missing.
   */
  @Get('setup-status')
  @RequirePermissions('clinic.settings.read')
  setupStatus(): Promise<Record<string, boolean | number>> {
    return this.clinics.setupStatus();
  }

  @Get('settings')
  @RequirePermissions('clinic.settings.read')
  getSettings(): Promise<Record<string, unknown>> {
    return this.clinics.getSettings();
  }

  @Patch('settings')
  @RequirePermissions('clinic.settings.write')
  updateSettings(@Body() dto: UpdateClinicSettingsDto): Promise<Record<string, unknown>> {
    return this.clinics.updateSettings(dto);
  }
}
