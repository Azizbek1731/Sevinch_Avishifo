'use client';

import type {
  PatientCheckoutInput,
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
  ServiceKind,
} from '@avishifo/shared';
import type { Localizable } from '@/lib/localized';
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
  lines: Pick<InvoiceLine, 'id' | 'title' | 'quantity' | 'lineTotal'>[];
}

export interface InvoiceLine {
  id: string;
  serviceId: string | null;
  /** Snapshot of the service name at billing time: string or { uz, ru, en }. */
  title: Localizable;
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
  note: string | null;
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

export type CashAccountMethod = 'CASH' | 'CARD' | 'CLICK';

export interface CashAccount {
  method: CashAccountMethod;
  opening: MoneyString;
  receipts: MoneyString;
  deposits: MoneyString;
  refunds: MoneyString;
  expenses: MoneyString;
  expected: MoneyString;
  actual: MoneyString | null;
  difference: MoneyString | null;
}

export interface CashierShift {
  id: string;
  branchId: string;
  cashierUserId: string;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  closedAt: string | null;
  openingCash: MoneyString;
  openingCard: MoneyString;
  openingClick: MoneyString;
  unallocatedOpeningTransfer: MoneyString;
  requiresOpeningAllocation: boolean;
  /** What the transfer account held at opening, entered by whoever opened. */
  openingTransfer: MoneyString;
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
  accounts: CashAccount[];
  open: true;
  /** Who opened the branch register — shown so the handover is traceable. */
  cashier: { id: string; fullName: string };
  cashIn: MoneyString;
  /** Deposits taken in cash — they are in the drawer like any other note. */
  cashDeposits: MoneyString;
  cashOut: MoneyString;
  /** Clinic spending taken out of this drawer — already deducted below. */
  expenseOut: MoneyString;
  expectedCashSoFar: MoneyString;
  /** Opening figure plus card/online turnover, net of refunds. */
  transferTotal: MoneyString;
  transferRefunds: MoneyString;
  transferByMethod: Array<{ method: PaymentMethod; amount: MoneyString; count: number }>;
}

export interface ShiftPaymentRow {
  id: string;
  checkoutId: string | null;
  amount: MoneyString;
  method: PaymentMethod;
  note: string | null;
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
    accounts: CashAccount[];
    cashier: { id: string; fullName: string };
    openedAt: string;
    openingCash: MoneyString;
    openingTransfer: MoneyString;
    expectedCash: MoneyString;
    transferTotal: MoneyString;
  }>;
  totals: {
    accounts: CashAccount[];
    unallocatedOpeningTransfer?: MoneyString;
    expectedCash: MoneyString;
    transferTotal: MoneyString;
    openDrawers: number;
  };
  /** Online money that arrived with nobody at the desk — no register owns it. */
  unattachedOnlineToday: MoneyString;
}

export interface ShiftHistoryItem extends CashierShift {
  cashier: { id: string; fullName: string };
}

export interface ShiftReport {
  accounts: CashAccount[];
  openingCash: MoneyString;
  openingTransfer: MoneyString;
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

export interface PendingPatient {
  id: string;
  mrn: string;
  fullName: string;
  phone: string | null;
  invoiceCount: number;
  due: string;
  oldestAt: string;
}
export interface PatientOutstanding {
  patient: PatientBrief & { balance: string };
  invoices: Array<
    Pick<
      InvoiceListItem,
      'id' | 'number' | 'status' | 'total' | 'paidTotal' | 'due' | 'createdAt' | 'lines'
    >
  >;
}

export interface ReceiptPayload {
  checkout?: {
    id: string;
    amount: string;
    paidBefore: string;
    invoices: Array<{ id: string; number: string; amount: string }>;
  };
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
  pending?: boolean;
  search?: string;
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
  pendingPatients: (query: { search?: string; page?: number; limit?: number }) =>
    api.get<PendingPatient[]>('/patient-payments/pending', query),
  patientOutstanding: (patientId: string) =>
    api.get<PatientOutstanding>(`/patient-payments/patients/${patientId}`),
  checkout: (input: PatientCheckoutInput) =>
    api.post<{ checkoutId: string; total: string }>('/patient-payments', input),
  checkoutReceipt: (id: string) => api.get<ReceiptPayload>(`/patient-payments/${id}/receipt`),
  // shifts
  currentShift: () => api.get<CurrentShift | null>('/shifts/current'),
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
    api.post<{ payment: InvoicePayment; invoice: InvoiceSummary }>(
      `/invoices/${id}/payments`,
      body,
    ),
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
  searchServices: (search: string, kind?: ServiceKind) =>
    api.get<ServiceOption[]>('/services', {
      isActive: true,
      kind,
      search: search || undefined,
      limit: 20,
    }),
  searchPatients: (search: string) => api.get<PatientBrief[]>('/patients', { search, limit: 10 }),
};

/** "1 500 000,5" → "1500000.5" (UI convenience before zod money validation). */
export function sanitizeMoney(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, '')
    .replace(',', '.');
}
