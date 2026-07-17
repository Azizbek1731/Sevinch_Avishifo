import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators';
import type { PaginatedResult } from '../../common/pagination';
import { VisitsService } from './visits.service';
import { AddDrugDto, DrugQueryDto, Icd10QueryDto } from './dto';

/** Clinical directories: global ICD-10 catalogue + drug autocomplete (global + clinic rows). */
@ApiTags('visits')
@Controller()
export class DirectoriesController {
  constructor(private readonly visits: VisitsService) {}

  @Get('icd10')
  @RequirePermissions('visits.read')
  searchIcd10(@Query() query: Icd10QueryDto): Promise<PaginatedResult<unknown>> {
    return this.visits.searchIcd10(query);
  }

  @Get('drugs')
  @RequirePermissions('visits.read')
  searchDrugs(@Query() query: DrugQueryDto): Promise<PaginatedResult<unknown>> {
    return this.visits.searchDrugs(query);
  }

  @Post('drugs')
  @RequirePermissions('visits.write')
  addDrug(@Body() dto: AddDrugDto): Promise<Record<string, unknown>> {
    return this.visits.addDrug(dto);
  }
}
