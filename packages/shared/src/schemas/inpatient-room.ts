import { z } from 'zod';
import { idSchema, moneySchema, paginationQuerySchema } from './common';

export const inpatientRoomFloorSchema = z.coerce.number().int().min(1).max(20);

export const createInpatientRoomSchema = z.object({
  branchId: idSchema,
  floor: inpatientRoomFloorSchema,
  number: z.string().trim().min(1).max(40),
  name: z.string().trim().max(120).optional(),
  pricePerDay: moneySchema,
});
export type CreateInpatientRoomInput = z.infer<typeof createInpatientRoomSchema>;

export const updateInpatientRoomSchema = z.object({
  floor: inpatientRoomFloorSchema.optional(),
  number: z.string().trim().min(1).max(40).optional(),
  name: z.string().trim().max(120).nullable().optional(),
  pricePerDay: moneySchema.optional(),
  isActive: z.boolean().optional(),
});
export type UpdateInpatientRoomInput = z.infer<typeof updateInpatientRoomSchema>;

export const inpatientRoomQuerySchema = paginationQuerySchema.extend({
  branchId: idSchema.optional(),
  floor: inpatientRoomFloorSchema.optional(),
  activeOnly: z.coerce.boolean().optional(),
});
export type InpatientRoomQuery = z.infer<typeof inpatientRoomQuerySchema>;
