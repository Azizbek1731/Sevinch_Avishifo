import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import {
  createInpatientRoomSchema,
  inpatientRoomQuerySchema,
  updateInpatientRoomSchema,
} from '@avishifo/shared';
import { RequirePermissions } from '../../common/decorators';
import { InpatientRoomsService } from './inpatient-rooms.service';

class CreateInpatientRoomDto extends createZodDto(createInpatientRoomSchema) {}
class UpdateInpatientRoomDto extends createZodDto(updateInpatientRoomSchema) {}
class InpatientRoomQueryDto extends createZodDto(inpatientRoomQuerySchema) {}

@Controller('inpatient-rooms')
export class InpatientRoomsController {
  constructor(private readonly rooms: InpatientRoomsService) {}

  @Get()
  @RequirePermissions('admissions.read')
  list(@Query() query: InpatientRoomQueryDto) {
    return this.rooms.list(query);
  }

  @Get(':id')
  @RequirePermissions('admissions.read')
  get(@Param('id') id: string) {
    return this.rooms.get(id);
  }

  @Post()
  @RequirePermissions('admissions.write')
  create(@Body() dto: CreateInpatientRoomDto) {
    return this.rooms.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('admissions.write')
  update(@Param('id') id: string, @Body() dto: UpdateInpatientRoomDto) {
    return this.rooms.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('admissions.write')
  deactivate(@Param('id') id: string) {
    return this.rooms.deactivate(id);
  }
}
