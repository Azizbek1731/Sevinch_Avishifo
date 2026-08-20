'use client';

import type {
  AddDepositInput,
  AddPaymentInput,
  AddPaymentsInput,
  VoidPaymentInput,
  ApiMeta,
  CloseShiftInput,
  CreateInvoiceInput,
  CreateRefundInput,
  InvoiceStatus,
  MoneyString,
  OpenShiftInput,
  PaymentMethod,
  PaymentStatus,
  QuickInvoiceInput,
} from '@avishifo/shared';
import { api, type ApiResult } from '@/lib/api-client';

// ============================================================ types

export interface PatientBrief {
  id: string;
  mrn: string;
  fullName: string;
  phone: string | null;
}

export interface InvoiceSummary {
  id: string;
  number: string;
  branchId: string;
  patientId: string;
  visitId: string | null;
  status: InvoiceStatus;
  subtotal: MoneyString;
  discountTotal: MoneyString;
  total: MoneyString;
  paidTotal: MoneyString;
  due: MoneyString;
  note: string | null;
  issuedAt: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceListItem extends InvoiceSummary {
  patient: PatientBrief;
}

export interface InvoiceLine {
  id: string;
  serviceId: string | null;
  /** Snapshot of the service name at billing time: string or { uz, ru, en }. */
  title: import('@/lib/localized').Localizable;
  quantity: number;
  unitPrice: MoneyString;
  discount: MoneyString;
  lineTotal: MoneyString;
  performerUserId: string | null;
}

export interface InvoicePayment {
  id: string;
  invoiceId: string;
  branchId: string;
  amount: MoneyString;
  method: PaymentMethod;
  status: PaymentStatus;
  shiftId: string | null;
  providerTxId: string | null;
  receivedById: string | null;
  paidAt: string;
  createdAt: string;
}

export interface InvoiceRefund {
  id: string;
  invoiceId: string;
  amount: MoneyString;
  method: PaymentMethod;
  reason: string;
  shiftId: string | null;
  createdById: string;
  createdAt: string;
}

export interface InvoiceDetail extends InvoiceSummary {
  patient: PatientBrief;
  lines: InvoiceLine[];
  payments: InvoicePayment[];
  refunds: InvoiceRefund[];
}

/** Result of a front-desk sale (`POST /invoices/quick`). */
export interface QuickInvoiceResult {
  invoice: InvoiceSummary;
  lines: InvoiceLine[];
  payment?: InvoicePayment;
  paid: boolean;
}

export interface CashierShift {
  id: string;
  branchId: string;
  cashierUserId: string;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  closedAt: string | null;
  openingCash: MoneyString;
  expectedCash: MoneyString | null;
  actualCash: MoneyString | null;
  /** What our ledger says went through the acquiring channels this shift. */
  expectedTransfer: MoneyString | null;
  /** What the terminal and PSP cabinets reported. null = nobody checked. */
  actualTransfer: MoneyString | null;
  transferUnverifiedReason: string | null;
  closedById: string | null;
  note: string | null;
}

export interface CurrentShift extends CashierShift {
  open: true;
  /** Whose drawer this is. The screen must say so — it never used to. */
  cashier: { id: string; fullName: string };
  /** How many other people hold a drawer in this branch right now. */
  otherDrawers: number;
  cashIn: MoneyString;
  /** Deposits taken in cash — they are in the drawer like any other note. */
  cashDeposits: MoneyString;
  cashOut: MoneyString;
  /** Clinic spending taken out of this drawer — already deducted below. */
  expenseOut: MoneyString;
  expectedCashSoFar: MoneyString;
  /** Card and online money routed through this drawer, net of refunds. */
  transferTotal: MoneyString;
  transferRefunds: MoneyString;
  transferByMethod: Array<{ method: PaymentMethod; amount: MoneyString; count: number }>;
}

/** Returned instead of a shift when this user holds none but others do. */
export interface NoDrawer {
  open: false;
  otherDrawers: number;
}

export interface ShiftPaymentRow {
  id: string;
  amount: MoneyString;
  method: PaymentMethod;
  status: 'COMPLETED' | 'VOIDED';
  paidAt: string;
  invoiceId: string;
  invoiceNumber: string;
  patientName: string | null;
}

/** Every open register in the branch — the clinic-level view. */
export interface RegistersOverview {
  registers: Array<{
    shiftId: string;
    cashier: { id: string; fullName: string };
    openedAt: string;
    openingCash: MoneyString;
    expectedCash: MoneyString;
    transferTotal: MoneyString;
  }>;
  totals: { expectedCash: MoneyString; transferTotal: MoneyString; openDrawers: number };
  /** Online money that arrived with nobody at the desk — no register owns it. */
  unattachedOnlineToday: MoneyString;
}

export interface ShiftHistoryItem extends CashierShift {
  cashier: { id: string; fullName: string };
}

export interface ShiftReport {
  openingCash: MoneyString;
  cashIn: MoneyString;
  cashDeposits: MoneyString;
  cashOut: MoneyString;
  expenseOut: MoneyString;
  expectedCash: MoneyString;
  actualCash: MoneyString;
  difference: MoneyString;

  transferIn: MoneyString;
  transferRefunds: MoneyString;
  expectedTransfer: MoneyString;
  actualTransfer: MoneyString | null;
  /**
   * Never a shortage — nobody can be short of money they never held. A gap here
   * means our book and the acquirer's disagree and somebody has to look.
   */
  transferDifference: MoneyString | null;
  transferUnverifiedReason: string | null;

  byMethod: Array<{ method: PaymentMethod; amount: MoneyString; count: number }>;
}

export interface CloseShiftResult {
  shift: CashierShift;
  report: ShiftReport;
}

export interface DebtorRow {
  patient: PatientBrief;
  debt: MoneyString;
  oldestInvoiceDate: string | null;
}

export interface DebtorsResult {
  items: DebtorRow[];
  meta: ApiMeta;
  totalDebt: MoneyString;
}

export interface PatientBalance {
  balance: MoneyString;
  transactions: {
    items: Array<{
      id: string;
      patientId: string;
      type: string;
      amount: MoneyString;
      invoiceId: string | null;
      note: string | null;
      createdById: string | null;
      createdAt: string;
    }>;
    meta: ApiMeta;
  };
}

export interface DepositResult {
  balance: MoneyString;
  transaction: { id: string };
}

export interface ServiceOption {
  id: string;
  code: string;
  name: { uz: string; ru?: string; en?: string };
  currentPrice: MoneyString | null;
  isActive: boolean;
}

export interface ReceiptSettings {
  paperWidth?: '58' | '80';
  fontScale?: 'sm' | 'md' | 'lg';
  showLogo?: boolean;
  headerText?: string;
  footerText?: string;
  showTaxId?: boolean;
  showCashier?: boolean;
  showPatientMrn?: boolean;
  showBranch?: boolean;
}

export interface ReceiptPayload {
  clinic: {
    name: string;
    legalName: string | null;
    taxId: string | null;
    logoUrl: string | null;
    phone: string | null;
    address: string | null;
  } | null;
  branch: { name: string; address: string | null; phone: string | null } | null;
  receipt: ReceiptSettings;
  invoice: InvoiceSummary;
  patient: { id: string; mrn: string; fullName: string };
  lines: InvoiceLine[];
  payments: InvoicePayment[];
  totals: {
    subtotal: MoneyString;
    discountTotal: MoneyString;
    total: MoneyString;
    paidTotal: MoneyString;
    due: MoneyString;
  };
  printedAt: string;
}

export interface InvoiceListQuery {
  page?: number;
  limit?: number;
  status?: InvoiceStatus;
  patientId?: string;
  branchId?: string;
  from?: string;
  to?: string;
}

// ============================================================ fetchers

export const billingApi = {
  // shifts
  currentShift: () => api.get<CurrentShift | NoDrawer | null>('/shifts/current'),
  registersOverview: () => api.get<RegistersOverview>('/shifts/overview'),
  currentShiftPayments: () => api.get<ShiftPaymentRow[]>('/shifts/current/payments'),
  openShift: (body: OpenShiftInput) => api.post<CurrentShift>('/shifts/open', body),
  closeShift: (body: CloseShiftInput) => api.post<CloseShiftResult>('/shifts/close', body),
  shiftHistory: (q: { branchId?: string; page?: number }) =>
    api.get<ShiftHistoryItem[]>('/shifts', q),

  // invoices
  listInvoices: (q: InvoiceListQuery): Promise<ApiResult<InvoiceListItem[]>> =>
    api.get<InvoiceListItem[]>('/invoices', { ...q }),
  getInvoice: (id: string) => api.get<InvoiceDetail>(`/invoices/${id}`),
  createInvoice: (body: CreateInvoiceInput) => api.post<InvoiceDetail>('/invoices', body),
  quickInvoice: (body: QuickInvoiceInput) => api.post<QuickInvoiceResult>('/invoices/quick', body),
  issueInvoice: (id: string) => api.post<InvoiceSummary>(`/invoices/${id}/issue`),
  cancelInvoice: (id: string) => api.post<InvoiceSummary>(`/invoices/${id}/cancel`),
  addPayment: (id: string, body: AddPaymentInput) =>
    api.post<{ payment: InvoicePayment; invoice: InvoiceSummary }>(`/invoices/${id}/payments`, body),
  /** Settle an invoice across several methods in one request. */
  addPayments: (id: string, body: AddPaymentsInput) =>
    api.post<{ payment: InvoicePayment; invoice: InvoiceSummary }>(
      `/invoices/${id}/payments/split`,
      body,
    ),
  /** Reverse a payment entered by mistake (not a refund — no money moves back). */
  voidPayment: (paymentId: string, body: VoidPaymentInput) =>
    api.post<{ payment: InvoicePayment }>(`/invoices/payments/${paymentId}/void`, body),
  addRefund: (id: string, body: CreateRefundInput) =>
    api.post<{ refund: InvoiceRefund; invoice: InvoiceSummary }>(`/invoices/${id}/refunds`, body),
  getReceipt: (id: string) => api.get<ReceiptPayload>(`/invoices/${id}/receipt`),

  // balance & debtors
  addDeposit: (patientId: string, body: AddDepositInput) =>
    api.post<DepositResult>(`/patients/${patientId}/deposits`, body),
  getBalance: (patientId: string) => api.get<PatientBalance>(`/patients/${patientId}/balance`),
  listDebtors: (q: { page?: number }) => api.get<DebtorsResult>('/debtors', q),

  // lookups
  searchServices: (search: string) =>
    api.get<ServiceOption[]>('/services', { isActive: true, search: search || undefined, limit: 20 }),
  searchPatients: (search: string) =>
    api.get<PatientBrief[]>('/patients', { search, limit: 10 }),
};

/** "1 500 000,5" → "1500000.5" (UI convenience before zod money validation). */
export function sanitizeMoney(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, '')
    .replace(',', '.');
}
