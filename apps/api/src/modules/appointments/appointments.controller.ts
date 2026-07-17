import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@avishifo/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { PaginatedResult } from '../../common/pagination';
import { AppointmentsService } from './appointments.service';
import {
  type AppointmentDto,
  type RecurringResultDto,
} from './appointments.service';
import { SlotsService } from './slots.service';
import { type FreeSlot } from './slots.service';
import { AppointmentQueryDto, ChangeAppointmentStatusDto, CreateAppointmentDto, CreateRecurringAppointmentDto, SlotsQueryDto, UpdateAppointmentDto } from './dto';

@ApiTags('appointments')
@Controller('appointments')
export class AppointmentsController {
  constructor(
    private readonly appointments: AppointmentsService,
    private readonly slots: SlotsService,
  ) {}

  @Get()
  @RequirePermissions('appointments.read')
  list(@Query() query: AppointmentQueryDto): Promise<PaginatedResult<AppointmentDto>> {
    return this.appointments.findAll(query);
  }

  /** Free slots for a doctor on a calendar day (declared before :id routes). */
  @Get('slots')
  @RequirePermissions('appointments.read')
  freeSlots(@Query() query: SlotsQueryDto): Promise<FreeSlot[]> {
    return this.slots.getFreeSlots(query);
  }

  @Get(':id')
  @RequirePermissions('appointments.read')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<AppointmentDto> {
    return this.appointments.findOne(id);
  }

  @Post()
  @RequirePermissions('appointments.write')
  async create(
    @Body() dto: CreateAppointmentDto,
    @CurrentUser() user: AuthUser,
  ): Promise<AppointmentDto> {
    const { id } = await this.appointments.create(dto, user.id);
    return this.appointments.findOne(id);
  }

  @Post('recurring')
  @RequirePermissions('appointments.write')
  createRecurring(
    @Body() dto: CreateRecurringAppointmentDto,
    @CurrentUser() user: AuthUser,
  ): Promise<RecurringResultDto> {
    return this.appointments.createRecurring(dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions('appointments.write')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAppointmentDto,
    @CurrentUser() user: AuthUser,
  ): Promise<AppointmentDto> {
    return this.appointments.update(id, dto, user.id);
  }

  @Post(':id/status')
  @RequirePermissions('appointments.write')
  changeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeAppointmentStatusDto,
    @CurrentUser() user: AuthUser,
  ): Promise<AppointmentDto> {
    return this.appointments.changeStatus(id, dto, user);
  }
}
