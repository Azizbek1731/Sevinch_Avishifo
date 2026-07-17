import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@avishifo/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { StaffService } from './staff.service';
import { AddScheduleExceptionDto, KpiQueryDto, ScheduleQueryDto, SetDoctorScheduleDto, StaffDirectoryQueryDto, UpsertStaffProfileDto } from './dto';

@ApiTags('staff')
@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  @RequirePermissions('staff.read')
  directory(@Query() query: StaffDirectoryQueryDto) {
    return this.staff.directory(query);
  }

  @Put(':userId/profile')
  @RequirePermissions('staff.write')
  upsertProfile(@Param('userId') userId: string, @Body() body: UpsertStaffProfileDto) {
    return this.staff.upsertProfile(userId, body);
  }

  // ------------------------------------------------------------- schedule

  @Get(':userId/schedule')
  @RequirePermissions('schedules.read')
  getSchedule(@Param('userId') userId: string, @Query() query: ScheduleQueryDto) {
    return this.staff.getSchedule(userId, query);
  }

  @Put(':userId/schedule')
  @RequirePermissions('schedules.write')
  setSchedule(@Param('userId') userId: string, @Body() body: SetDoctorScheduleDto) {
    return this.staff.setSchedule(userId, body);
  }

  @Post(':userId/schedule-exceptions')
  @RequirePermissions('schedules.write')
  addException(@Param('userId') userId: string, @Body() body: AddScheduleExceptionDto) {
    return this.staff.addException(userId, body);
  }

  @Delete('schedule-exceptions/:id')
  @RequirePermissions('schedules.write')
  removeException(@Param('id') id: string) {
    return this.staff.removeException(id);
  }

  // ------------------------------------------------------------- KPI

  @Get(':userId/kpi')
  @RequirePermissions('payroll.read')
  kpi(
    @Param('userId') userId: string,
    @Query() query: KpiQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.staff.kpi(userId, query, user);
  }
}
