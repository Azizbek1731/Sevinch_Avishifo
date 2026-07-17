import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  addDepositSchema,
  addPaymentSchema,
  CashierShiftStatus,
  closeShiftSchema,
  createExpenseSchema,
  createInvoiceSchema,
  createRefundSchema,
  debtorQuerySchema,
  expenseCategoryUpsertSchema,
  expenseQuerySchema,
  idSchema,
  invoiceQuerySchema,
  openShiftSchema,
  paginationQuerySchema,
} from '@avishifo/shared';

// ---- Invoices
export class CreateInvoiceDto extends createZodDto(createInvoiceSchema) {}
export class InvoiceQueryDto extends createZodDto(invoiceQuerySchema) {}
export class AddPaymentDto extends createZodDto(addPaymentSchema) {}
export class CreateRefundDto extends createZodDto(createRefundSchema) {}

// ---- Cashier shifts
export class OpenShiftDto extends createZodDto(openShiftSchema) {}
export class CloseShiftDto extends createZodDto(closeShiftSchema) {}

const shiftQuerySchema = paginationQuerySchema.extend({
  branchId: idSchema.optional(),
  status: z.nativeEnum(CashierShiftStatus).optional(),
});
export class ShiftQueryDto extends createZodDto(shiftQuerySchema) {}

// ---- Patient balance / debtors
export class AddDepositDto extends createZodDto(addDepositSchema) {}
export class DebtorQueryDto extends createZodDto(debtorQuerySchema) {}
export class PaginationQueryDto extends createZodDto(paginationQuerySchema) {}

// ---- Expenses
export class CreateExpenseDto extends createZodDto(createExpenseSchema) {}
export class UpdateExpenseDto extends createZodDto(createExpenseSchema.partial()) {}
export class ExpenseCategoryUpsertDto extends createZodDto(expenseCategoryUpsertSchema) {}
export class ExpenseQueryDto extends createZodDto(expenseQuerySchema) {}
