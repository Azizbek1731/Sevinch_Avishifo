import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthUser, RecordAccessRequestDto } from '@avishifo/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { PaginatedResult } from '../../common/pagination';
import { DecideRecordAccessDto, RecordAccessListQueryDto } from './dto';
import { RecordAccessService } from './record-access.service';

/**
 * Staff-side inbox for patients asking to read their own clinical history.
 * Doctors and clinic admins decide; the receptionist deliberately cannot.
 */
@ApiTags('record-access')
@Controller('record-access')
export class RecordAccessController {
  constructor(private readonly service: RecordAccessService) {}

  @Get()
  @RequirePermissions('patients.recordAccess.manage')
  list(@Query() query: RecordAccessListQueryDto): Promise<PaginatedResult<RecordAccessRequestDto>> {
    return this.service.list(query);
  }

  /** Sidebar badge — how many decisions are waiting. */
  @Get('pending-count')
  @RequirePermissions('patients.recordAccess.manage')
  pendingCount(): Promise<{ pending: number }> {
    return this.service.pendingCount();
  }

  @Patch(':id')
  @RequirePermissions('patients.recordAccess.manage')
  decide(
    @Param('id') id: string,
    @Body() dto: DecideRecordAccessDto,
    @CurrentUser() user: AuthUser,
  ): Promise<RecordAccessRequestDto> {
    return this.service.decide(id, dto, user);
  }
}
