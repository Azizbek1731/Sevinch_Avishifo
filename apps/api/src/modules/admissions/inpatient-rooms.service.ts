import { Injectable } from '@nestjs/common';
import { Prisma, type InpatientRoom } from '@prisma/client';
import {
  AuditAction,
  ErrorCode,
  type CreateInpatientRoomInput,
  type InpatientRoomQuery,
  type UpdateInpatientRoomInput,
} from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { paginated } from '../../common/pagination';
import { AuditService } from '../../core/audit/audit.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';

@Injectable()
export class InpatientRoomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private map(room: InpatientRoom & { occupied?: number }) {
    const occupied = room.occupied ?? 0;
    return {
      id: room.id,
      branchId: room.branchId,
      floor: room.floor,
      number: room.number,
      name: room.name,
      capacity: room.capacity,
      pricePerDay: room.pricePerDay.toFixed(2),
      isActive: room.isActive,
      occupied,
      /** Sig‘im cheksiz — har doim yotqizish mumkin. */
      available: Number.MAX_SAFE_INTEGER,
      createdAt: room.createdAt.toISOString(),
      updatedAt: room.updatedAt.toISOString(),
    };
  }

  private async occupancyByRoom(roomIds: string[]): Promise<Map<string, number>> {
    if (!roomIds.length) return new Map();
    const rows = await this.prisma.db.admission.groupBy({
      by: ['inpatientRoomId'],
      where: {
        inpatientRoomId: { in: roomIds },
        status: 'ACTIVE',
      },
      _count: { _all: true },
    });
    return new Map(
      rows
        .filter((row) => row.inpatientRoomId)
        .map((row) => [row.inpatientRoomId!, row._count._all]),
    );
  }

  async list(query: InpatientRoomQuery) {
    const where: Prisma.InpatientRoomWhereInput = {
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.floor !== undefined ? { floor: query.floor } : {}),
      ...(query.activeOnly ? { isActive: true } : {}),
    };
    const page = query.page ?? 1;
    const limit = query.limit ?? 100;
    const [total, rooms] = await Promise.all([
      this.prisma.db.inpatientRoom.count({ where }),
      this.prisma.db.inpatientRoom.findMany({
        where,
        orderBy: [{ floor: 'asc' }, { number: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    const occupied = await this.occupancyByRoom(rooms.map((room) => room.id));
    return paginated(
      rooms.map((room) => this.map({ ...room, occupied: occupied.get(room.id) ?? 0 })),
      { page, limit, total },
    );
  }

  async get(id: string) {
    const room = await this.prisma.db.inpatientRoom.findFirst({ where: { id } });
    if (!room) throw new AppException(ErrorCode.NOT_FOUND, 'Palata topilmadi', 404);
    const occupied = await this.occupancyByRoom([id]);
    return this.map({ ...room, occupied: occupied.get(id) ?? 0 });
  }

  private async assertBranch(branchId: string): Promise<void> {
    const branch = await this.prisma.db.branch.findFirst({ where: { id: branchId, isActive: true } });
    if (!branch) throw new AppException(ErrorCode.VALIDATION_ERROR, 'Filial topilmadi', 400);
  }

  async create(dto: CreateInpatientRoomInput) {
    await this.assertBranch(dto.branchId);
    const clinicId = TenantContext.requireClinicId();
    try {
      const room = await this.prisma.db.inpatientRoom.create({
        data: {
          clinicId,
          branchId: dto.branchId,
          floor: dto.floor,
          number: dto.number,
          name: dto.name?.trim() || null,
          capacity: 9999,
          pricePerDay: dto.pricePerDay,
        },
      });
      await this.audit.log({
        action: AuditAction.CREATE,
        entity: 'InpatientRoom',
        entityId: room.id,
        after: { floor: room.floor, number: room.number, pricePerDay: room.pricePerDay.toFixed(2) },
      });
      return this.map({ ...room, occupied: 0 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppException(ErrorCode.VALIDATION_ERROR, 'Bu etajda shu raqamli palata allaqachon bor', 409);
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateInpatientRoomInput) {
    const current = await this.prisma.db.inpatientRoom.findFirst({ where: { id } });
    if (!current) throw new AppException(ErrorCode.NOT_FOUND, 'Palata topilmadi', 404);
    try {
      const room = await this.prisma.db.inpatientRoom.update({
        where: { id },
        data: {
          ...(dto.floor !== undefined ? { floor: dto.floor } : {}),
          ...(dto.number !== undefined ? { number: dto.number } : {}),
          ...(dto.name !== undefined ? { name: dto.name?.trim() || null } : {}),
          ...(dto.pricePerDay !== undefined ? { pricePerDay: dto.pricePerDay } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });
      await this.audit.log({
        action: AuditAction.UPDATE,
        entity: 'InpatientRoom',
        entityId: room.id,
        before: {
          floor: current.floor,
          number: current.number,
          pricePerDay: current.pricePerDay.toFixed(2),
          isActive: current.isActive,
        },
        after: {
          floor: room.floor,
          number: room.number,
          pricePerDay: room.pricePerDay.toFixed(2),
          isActive: room.isActive,
        },
      });
      const occupied = (await this.occupancyByRoom([id])).get(id) ?? 0;
      return this.map({ ...room, occupied });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppException(ErrorCode.VALIDATION_ERROR, 'Bu etajda shu raqamli palata allaqachon bor', 409);
      }
      throw error;
    }
  }

  async deactivate(id: string) {
    return this.update(id, { isActive: false });
  }

  /** Resolve catalog room for admit/update (sig‘im cheklanmaydi). */
  async resolveForStay(params: {
    inpatientRoomId: string;
    branchId: string;
    excludeAdmissionId?: string;
  }) {
    const room = await this.prisma.db.inpatientRoom.findFirst({
      where: { id: params.inpatientRoomId, branchId: params.branchId, isActive: true },
    });
    if (!room) throw new AppException(ErrorCode.VALIDATION_ERROR, 'Faol palatani tanlang', 400);
    return room;
  }
}
