import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators';
import type { PaginatedResult } from '../../common/pagination';
import { CreateUserDto, PermissionOverridesDto, UpdateUserDto, UpdateUserStatusDto, UserQueryDto } from './dto/user.dto';
import { UsersService } from './users.service';
import { type UserResponse } from './users.service';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequirePermissions('users.read')
  list(@Query() query: UserQueryDto): Promise<PaginatedResult<UserResponse>> {
    return this.usersService.list(query);
  }

  @Post()
  @RequirePermissions('users.write')
  create(@Body() dto: CreateUserDto): Promise<UserResponse> {
    return this.usersService.create(dto);
  }

  @Get(':id')
  @RequirePermissions('users.read')
  getById(@Param('id') id: string): Promise<UserResponse> {
    return this.usersService.getById(id);
  }

  @Patch(':id')
  @RequirePermissions('users.write')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto): Promise<UserResponse> {
    return this.usersService.update(id, dto);
  }

  @Patch(':id/status')
  @RequirePermissions('users.write')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateUserStatusDto,
  ): Promise<UserResponse> {
    return this.usersService.updateStatus(id, dto);
  }

  @Patch(':id/permission-overrides')
  @RequirePermissions('users.write')
  updatePermissionOverrides(
    @Param('id') id: string,
    @Body() dto: PermissionOverridesDto,
  ): Promise<UserResponse> {
    return this.usersService.updatePermissionOverrides(id, dto);
  }
}
