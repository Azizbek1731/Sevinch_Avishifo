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

/**
 * Front-desk one-shot sale: create the invoice, issue it and either settle it
 * right away (`PAY_NOW` → receipt) or leave it open as patient debt (`DEBT`).
 * Keeps the three-step create/issue/pay dance server-side so a half-finished
 * sale can never be left in DRAFT by a dropped connection.
 */
export const INVOICE_SETTLEMENTS = ['PAY_NOW', 'DEBT'] as const;
export type InvoiceSettlement = (typeof INVOICE_SETTLEMENTS)[number];

/**
 * One leg of a payment. A patient settling a 130 000 bill with 100 000 by Click
 * and 30 000 in cash is two of these against one invoice — which is how a front
 * desk actually takes money, and what a single `method` field could not express.
 */
export const paymentPartSchema = z.object({
  method: z.nativeEnum(PaymentMethod),
  amount: moneySchema,
});
export type PaymentPart = z.infer<typeof paymentPartSchema>;

/**
 * Capped at six: past that it is not a split any more, and every extra leg is
 * another row on the receipt and another shift entry to reconcile.
 */
export const paymentSplitSchema = z.array(paymentPartSchema).min(1).max(6);

export const quickInvoiceSchema = z
  .object({
    patientId: idSchema,
    branchId: idSchema,
    visitId: idSchema.optional(),
    lines: z.array(invoiceLineSchema).min(1),
    settle: z.enum(INVOICE_SETTLEMENTS),
    /**
     * Required for PAY_NOW. One entry is the ordinary case; more than one splits
     * the total across methods. The server checks the sum against the invoice it
     * just built rather than trusting a total computed on the client.
     */
    payments: paymentSplitSchema.optional(),
    /**
     * Required for PAY_NOW — makes a retried submission idempotent. One key for
     * the whole sale; the server derives a stable per-leg key from it, so a
     * retry cannot double-charge any single leg.
     */
    idempotencyKey: z.string().uuid().optional(),
  })
  .refine((v) => v.settle !== 'PAY_NOW' || (v.payments?.length ?? 0) > 0, {
    message: 'payments is required when settle is PAY_NOW',
    path: ['payments'],
  })
  .refine((v) => v.settle !== 'PAY_NOW' || v.idempotencyKey !== undefined, {
    message: 'idempotencyKey is required when settle is PAY_NOW',
    path: ['idempotencyKey'],
  });
export type QuickInvoiceInput = z.infer<typeof quickInvoiceSchema>;

/** Settling an already-issued invoice, optionally across several methods. */
export const addPaymentsSchema = z.object({
  payments: paymentSplitSchema,
  idempotencyKey: z.string().uuid(),
});
export type AddPaymentsInput = z.infer<typeof addPaymentsSchema>;

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
