import { z } from 'zod';
import { InvoiceStatus, PaymentMethod } from '../enums';
import {
  dateOnlySchema,
  idSchema,
  isoDateTimeSchema,
  moneySchema,
  paginationQuerySchema,
} from './common';

export const invoiceLineSchema = z
  .object({
    serviceId: idSchema.optional(),
    /** Free-form title for ad-hoc lines without a service. */
    title: z.string().min(1).optional(),
    quantity: z.number().int().min(1),
    unitPrice: moneySchema,
    discount: moneySchema.default('0'),
    /** Doctor who performed the service (KPI/commission). */
    performerUserId: idSchema.optional(),
  })
  .refine((l) => l.serviceId !== undefined || l.title !== undefined, {
    message: 'Line requires serviceId or title',
    path: ['title'],
  });
export type InvoiceLineInput = z.infer<typeof invoiceLineSchema>;

/** Create from explicit lines, or from a visit (lines auto-generated). */
export const createInvoiceSchema = z
  .object({
    patientId: idSchema,
    branchId: idSchema,
    visitId: idSchema.optional(),
    lines: z.array(invoiceLineSchema).min(1).optional(),
  })
  .refine((v) => v.visitId !== undefined || v.lines !== undefined, {
    message: 'Either visitId or lines is required',
    path: ['lines'],
  });
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

export const addPaymentSchema = z.object({
  amount: moneySchema,
  method: z.nativeEnum(PaymentMethod),
  idempotencyKey: z.string().uuid(),
});
export type AddPaymentInput = z.infer<typeof addPaymentSchema>;

export const createRefundSchema = z.object({
  amount: moneySchema,
  method: z.nativeEnum(PaymentMethod),
  reason: z.string().min(3),
});
export type CreateRefundInput = z.infer<typeof createRefundSchema>;

export const openShiftSchema = z.object({
  openingCash: moneySchema.default('0'),
});
export type OpenShiftInput = z.infer<typeof openShiftSchema>;

export const closeShiftSchema = z.object({
  actualCash: moneySchema,
  note: z.string().optional(),
});
export type CloseShiftInput = z.infer<typeof closeShiftSchema>;

export const addDepositSchema = z.object({
  patientId: idSchema,
  amount: moneySchema,
  note: z.string().optional(),
});
export type AddDepositInput = z.infer<typeof addDepositSchema>;

export const payFromBalanceSchema = z.object({
  amount: moneySchema,
});
export type PayFromBalanceInput = z.infer<typeof payFromBalanceSchema>;

export const invoiceQuerySchema = paginationQuerySchema.extend({
  status: z.nativeEnum(InvoiceStatus).optional(),
  patientId: idSchema.optional(),
  branchId: idSchema.optional(),
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
});
export type InvoiceQueryInput = z.infer<typeof invoiceQuerySchema>;

export const debtorQuerySchema = paginationQuerySchema.extend({
  minDebt: moneySchema.optional(),
});
export type DebtorQueryInput = z.infer<typeof debtorQuerySchema>;

export const createExpenseSchema = z.object({
  branchId: idSchema,
  categoryId: idSchema,
  amount: moneySchema,
  date: dateOnlySchema,
  note: z.string().optional(),
});
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

export const expenseCategoryUpsertSchema = z.object({
  name: z.string().min(1),
});
export type ExpenseCategoryUpsertInput = z.infer<typeof expenseCategoryUpsertSchema>;

export const expenseQuerySchema = paginationQuerySchema.extend({
  branchId: idSchema.optional(),
  categoryId: idSchema.optional(),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
});
export type ExpenseQueryInput = z.infer<typeof expenseQuerySchema>;
