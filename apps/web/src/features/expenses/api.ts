'use client';

import type {
  CreateExpenseInput,
  ExpenseCategoryUpsertInput,
  ExpenseMethod,
  MoneyString,
} from '@avishifo/shared';
import { api, type ApiResult } from '@/lib/api-client';

// ============================================================ types

export interface ExpenseCategoryRow {
  id: string;
  name: string;
  isActive: boolean;
}

export interface ExpenseRow {
  id: string;
  branchId: string;
  categoryId: string;
  amount: MoneyString;
  method: ExpenseMethod;
  /** Set only for cash taken out of a register. */
  shiftId: string | null;
  date: string;
  note: string | null;
  createdById: string | null;
  createdAt: string;
  /** Non-null once withdrawn — only management is shown these. */
  deletedAt: string | null;
  category?: { id: string; name: string };
}

export interface ExpenseListResult {
  items: ExpenseRow[];
  meta: { page: number; limit: number; total: number };
  /** Total of the live rows matching the filter, so it never counts withdrawn ones. */
  sum: MoneyString;
}

export interface ExpenseFilters {
  categoryId?: string;
  method?: ExpenseMethod;
  from?: string;
  to?: string;
  deleted?: boolean;
  page?: number;
  limit?: number;
}

// ============================================================ calls

export const expensesApi = {
  list: (q: ExpenseFilters) => api.get<ExpenseListResult>('/expenses', { ...q }),
  create: (body: CreateExpenseInput) => api.post<ExpenseRow>('/expenses', body),
  update: (id: string, body: Partial<CreateExpenseInput>) =>
    api.patch<ExpenseRow>(`/expenses/${id}`, body),
  remove: (id: string) => api.delete<{ id: string }>(`/expenses/${id}`),

  categories: (): Promise<ApiResult<ExpenseCategoryRow[]>> =>
    api.get<ExpenseCategoryRow[]>('/expense-categories', { limit: 100 }),
  createCategory: (body: ExpenseCategoryUpsertInput) =>
    api.post<ExpenseCategoryRow>('/expense-categories', body),
  updateCategory: (id: string, body: ExpenseCategoryUpsertInput) =>
    api.patch<ExpenseCategoryRow>(`/expense-categories/${id}`, body),
  removeCategory: (id: string) => api.delete<{ id: string }>(`/expense-categories/${id}`),
};

/** Accepts "1 200,50" the way a keypad produces it. */
export function sanitizeMoney(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, '')
    .replace(',', '.');
}

/** Today in Tashkent, as the date input expects it. */
export function todayInTashkent(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date());
}
