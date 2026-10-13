import { z } from 'zod';
import { SurgeryPayoutType } from '../enums';
import { idSchema } from './common';

const payoutValueSchema = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,2})?$/)
  .refine((value) => Number(value) > 0, 'Amount must be positive');

export const createSurgeryPayoutSchema = z
  .object({
    type: z.nativeEnum(SurgeryPayoutType),
    value: payoutValueSchema,
    method: z.enum(['CASH', 'CARD', 'CLICK']),
    note: z.string().trim().max(500).optional(),
    idempotencyKey: idSchema,
  })
  .refine((input) => input.type !== 'PERCENT' || Number(input.value) <= 100, {
    path: ['value'],
    message: 'Percentage must not exceed 100',
  });
export type CreateSurgeryPayoutInput = z.infer<typeof createSurgeryPayoutSchema>;

export const voidSurgeryPayoutSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export type VoidSurgeryPayoutInput = z.infer<typeof voidSurgeryPayoutSchema>;
