import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators';
import type { PaginatedResult } from '../../common/pagination';
import { BranchesService } from './branches.service';
import {
  type BranchResponse,
  type RoomResponse,
} from './branches.service';
import { CreateBranchDto, CreateRoomDto, ListQueryDto, UpdateBranchDto, UpdateRoomDto } from './dto';

/**
 * No controller prefix: hosts both `/branches/**` and `/rooms/:id` routes
 * (rooms are addressed flat for mutations, nested under a branch for list/create).
 */
@ApiTags('branches')
@Controller()
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  // ------------------------------------------------------------ branches

  /** Any authenticated user can read branches. */
  @Get('branches')
  list(@Query() query: ListQueryDto): Promise<PaginatedResult<BranchResponse>> {
    return this.branches.list(query);
  }

  @Post('branches')
  @RequirePermissions('branches.write')
  create(@Body() dto: CreateBranchDto): Promise<BranchResponse> {
    return this.branches.create(dto);
  }

  @Get('branches/:id')
  getById(@Param('id') id: string): Promise<BranchResponse> {
    return this.branches.getById(id);
  }

  @Patch('branches/:id')
  @RequirePermissions('branches.write')
  update(@Param('id') id: string, @Body() dto: UpdateBranchDto): Promise<BranchResponse> {
    return this.branches.update(id, dto);
  }

  /** Soft delete (isActive = false). */
  @Delete('branches/:id')
  @RequirePermissions('branches.write')
  remove(@Param('id') id: string): Promise<BranchResponse> {
    return this.branches.softDelete(id);
  }

  // ------------------------------------------------------------ rooms

  @Get('branches/:id/rooms')
  listRooms(
    @Param('id') branchId: string,
    @Query() query: ListQueryDto,
  ): Promise<PaginatedResult<RoomResponse>> {
    return this.branches.listRooms(branchId, query);
  }

  @Post('branches/:id/rooms')
  @RequirePermissions('branches.write')
  createRoom(@Param('id') branchId: string, @Body() dto: CreateRoomDto): Promise<RoomResponse> {
    return this.branches.createRoom(branchId, dto);
  }

  @Patch('rooms/:id')
  @RequirePermissions('branches.write')
  updateRoom(@Param('id') id: string, @Body() dto: UpdateRoomDto): Promise<RoomResponse> {
    return this.branches.updateRoom(id, dto);
  }

  /** Soft delete (isActive = false). */
  @Delete('rooms/:id')
  @RequirePermissions('branches.write')
  removeRoom(@Param('id') id: string): Promise<RoomResponse> {
    return this.branches.softDeleteRoom(id);
  }

  // ------------------------------------------------------------ display token

  /** Issue the long-lived socket auth token for the TV display app of a branch. */
  @Post('branches/:id/display-token')
  @RequirePermissions('clinic.settings.write')
  createDisplayToken(@Param('id') branchId: string): Promise<{ token: string; wsUrl: string }> {
    return this.branches.createDisplayToken(branchId);
  }
}
