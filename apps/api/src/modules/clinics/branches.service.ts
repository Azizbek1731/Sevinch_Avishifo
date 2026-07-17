import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, type Branch, type Room } from '@prisma/client';
import { AuditAction, ErrorCode } from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { paginated, skipTake, type PaginatedResult } from '../../common/pagination';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import { AuditService } from '../../core/audit/audit.service';
import { AppConfigService } from '../../core/config/app-config.service';
import { CreateBranchDto, CreateRoomDto, UpdateBranchDto, UpdateRoomDto } from './dto';

export interface BranchResponse {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  workingHours: unknown;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RoomResponse {
  id: string;
  branchId: string;
  number: string;
  name: string | null;
  type: string;
  specialties: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

@Injectable()
export class BranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
  ) {}

  // ------------------------------------------------------------ branches

  async list(query: { page: number; limit: number }): Promise<PaginatedResult<BranchResponse>> {
    const [items, total] = await Promise.all([
      this.prisma.db.branch.findMany({ orderBy: { createdAt: 'asc' }, ...skipTake(query) }),
      this.prisma.db.branch.count(),
    ]);
    return paginated(
      items.map((b) => this.mapBranch(b)),
      { page: query.page, limit: query.limit, total },
    );
  }

  async getById(id: string): Promise<BranchResponse> {
    return this.mapBranch(await this.requireBranch(id));
  }

  async create(dto: CreateBranchDto): Promise<BranchResponse> {
    const branch = await this.prisma.db.branch.create({
      data: {
        // Satisfies the type; the tenant extension stamps the same value at runtime.
        clinicId: TenantContext.requireClinicId(),
        name: dto.name,
        address: dto.address,
        phone: dto.phone,
        latitude: dto.latitude,
        longitude: dto.longitude,
        workingHours: dto.workingHours as Prisma.InputJsonValue,
      },
    });
    return this.mapBranch(branch);
  }

  async update(id: string, dto: UpdateBranchDto): Promise<BranchResponse> {
    await this.requireBranch(id);
    const branch = await this.prisma.db.branch.update({
      where: { id },
      data: {
        name: dto.name,
        address: dto.address,
        phone: dto.phone,
        latitude: dto.latitude,
        longitude: dto.longitude,
        workingHours:
          dto.workingHours !== undefined
            ? (dto.workingHours as Prisma.InputJsonValue)
            : undefined,
      },
    });
    return this.mapBranch(branch);
  }

  /** Soft delete: mark inactive; historical data keeps referencing the branch. */
  async softDelete(id: string): Promise<BranchResponse> {
    await this.requireBranch(id);
    const branch = await this.prisma.db.branch.update({
      where: { id },
      data: { isActive: false },
    });
    return this.mapBranch(branch);
  }

  // ------------------------------------------------------------ rooms

  async listRooms(
    branchId: string,
    query: { page: number; limit: number },
  ): Promise<PaginatedResult<RoomResponse>> {
    await this.requireBranch(branchId);
    const [items, total] = await Promise.all([
      this.prisma.db.room.findMany({
        where: { branchId },
        orderBy: { number: 'asc' },
        ...skipTake(query),
      }),
      this.prisma.db.room.count({ where: { branchId } }),
    ]);
    return paginated(
      items.map((r) => this.mapRoom(r)),
      { page: query.page, limit: query.limit, total },
    );
  }

  async createRoom(branchId: string, dto: CreateRoomDto): Promise<RoomResponse> {
    await this.requireBranch(branchId);
    try {
      const room = await this.prisma.db.room.create({
        data: {
          // Satisfies the type; the tenant extension stamps the same value at runtime.
          clinicId: TenantContext.requireClinicId(),
          branchId,
          number: dto.number,
          name: dto.name,
          type: dto.type,
          specialties: dto.specialties,
        },
      });
      return this.mapRoom(room);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppException(
          ErrorCode.CONFLICT,
          'A room with this number already exists in the branch',
          409,
        );
      }
      throw err;
    }
  }

  async updateRoom(id: string, dto: UpdateRoomDto): Promise<RoomResponse> {
    const existing = await this.prisma.db.room.findFirst({ where: { id } });
    if (!existing) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Room not found', 404);
    }
    try {
      const room = await this.prisma.db.room.update({
        where: { id },
        data: {
          number: dto.number,
          name: dto.name,
          type: dto.type,
          specialties: dto.specialties,
        },
      });
      return this.mapRoom(room);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppException(
          ErrorCode.CONFLICT,
          'A room with this number already exists in the branch',
          409,
        );
      }
      throw err;
    }
  }

  /** Soft delete: mark inactive. */
  async softDeleteRoom(id: string): Promise<RoomResponse> {
    const existing = await this.prisma.db.room.findFirst({ where: { id } });
    if (!existing) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Room not found', 404);
    }
    const room = await this.prisma.db.room.update({
      where: { id },
      data: { isActive: false },
    });
    return this.mapRoom(room);
  }

  // ------------------------------------------------------------ display token

  /** Long-lived JWT the TV display app uses to authenticate its socket connection. */
  async createDisplayToken(branchId: string): Promise<{ token: string; wsUrl: string }> {
    const branch = await this.requireBranch(branchId);
    const clinicId = TenantContext.requireClinicId();
    const token = await this.jwt.signAsync(
      { typ: 'display', clinicId, branchId: branch.id },
      { expiresIn: '365d' },
    );
    await this.audit.log({
      action: AuditAction.CREATE,
      entity: 'DisplayToken',
      entityId: branch.id,
      after: { branchId: branch.id },
    });
    return { token, wsUrl: this.config.env.API_URL };
  }

  // ------------------------------------------------------------ helpers

  private async requireBranch(id: string): Promise<Branch> {
    const branch = await this.prisma.db.branch.findFirst({ where: { id } });
    if (!branch) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Branch not found', 404);
    }
    return branch;
  }

  private mapBranch(branch: Branch): BranchResponse {
    return {
      id: branch.id,
      name: branch.name,
      address: branch.address,
      phone: branch.phone,
      latitude: branch.latitude,
      longitude: branch.longitude,
      workingHours: branch.workingHours,
      isActive: branch.isActive,
      createdAt: branch.createdAt.toISOString(),
      updatedAt: branch.updatedAt.toISOString(),
    };
  }

  private mapRoom(room: Room): RoomResponse {
    return {
      id: room.id,
      branchId: room.branchId,
      number: room.number,
      name: room.name,
      type: room.type,
      specialties: room.specialties,
      isActive: room.isActive,
      createdAt: room.createdAt.toISOString(),
      updatedAt: room.updatedAt.toISOString(),
    };
  }
}
