/**
 * Status/type enums — the single source of truth, mirrored 1:1 by Prisma enums
 * in apps/api/prisma/schema.prisma. If you change one side, change the other.
 */

export const UserRole = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  CLINIC_OWNER: 'CLINIC_OWNER',
  CLINIC_ADMIN: 'CLINIC_ADMIN',
  DOCTOR: 'DOCTOR',
  NURSE: 'NURSE',
  RECEPTIONIST: 'RECEPTIONIST',
  CASHIER: 'CASHIER',
  LAB_TECH: 'LAB_TECH',
  ACCOUNTANT: 'ACCOUNTANT',
  PATIENT: 'PATIENT',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const UserStatus = {
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const ClinicStatus = {
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type ClinicStatus = (typeof ClinicStatus)[keyof typeof ClinicStatus];

export const Locale = {
  UZ: 'uz',
  UZ_CYRL: 'uz-Cyrl',
  RU: 'ru',
  EN: 'en',
} as const;
export type Locale = (typeof Locale)[keyof typeof Locale];

export const Gender = {
  MALE: 'MALE',
  FEMALE: 'FEMALE',
} as const;
export type Gender = (typeof Gender)[keyof typeof Gender];

export const BloodGroup = {
  A_POS: 'A_POS',
  A_NEG: 'A_NEG',
  B_POS: 'B_POS',
  B_NEG: 'B_NEG',
  AB_POS: 'AB_POS',
  AB_NEG: 'AB_NEG',
  O_POS: 'O_POS',
  O_NEG: 'O_NEG',
  UNKNOWN: 'UNKNOWN',
} as const;
export type BloodGroup = (typeof BloodGroup)[keyof typeof BloodGroup];

export const RoomType = {
  CONSULTATION: 'CONSULTATION',
  PROCEDURE: 'PROCEDURE',
  LAB: 'LAB',
  ULTRASOUND: 'ULTRASOUND',
  XRAY: 'XRAY',
  TREATMENT: 'TREATMENT',
  OTHER: 'OTHER',
} as const;
export type RoomType = (typeof RoomType)[keyof typeof RoomType];

export const AppointmentStatus = {
  SCHEDULED: 'SCHEDULED',
  CONFIRMED: 'CONFIRMED',
  CHECKED_IN: 'CHECKED_IN',
  IN_QUEUE: 'IN_QUEUE',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  NO_SHOW: 'NO_SHOW',
  CANCELLED: 'CANCELLED',
} as const;
export type AppointmentStatus = (typeof AppointmentStatus)[keyof typeof AppointmentStatus];

export const QueueKind = {
  DOCTOR: 'DOCTOR',
  LAB: 'LAB',
  CUSTOM: 'CUSTOM',
} as const;
export type QueueKind = (typeof QueueKind)[keyof typeof QueueKind];

export const TicketStatus = {
  WAITING: 'WAITING',
  CALLED: 'CALLED',
  IN_ROOM: 'IN_ROOM',
  DONE: 'DONE',
  SKIPPED: 'SKIPPED',
} as const;
export type TicketStatus = (typeof TicketStatus)[keyof typeof TicketStatus];

export const TicketPriority = {
  NORMAL: 'NORMAL',
  PRIORITY: 'PRIORITY',
  EMERGENCY: 'EMERGENCY',
} as const;
export type TicketPriority = (typeof TicketPriority)[keyof typeof TicketPriority];

export const VisitStatus = {
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type VisitStatus = (typeof VisitStatus)[keyof typeof VisitStatus];

export const ReferralType = {
  SPECIALIST: 'SPECIALIST',
  LAB: 'LAB',
} as const;
export type ReferralType = (typeof ReferralType)[keyof typeof ReferralType];

export const ScheduleExceptionType = {
  VACATION: 'VACATION',
  SICK_LEAVE: 'SICK_LEAVE',
  DAY_OFF: 'DAY_OFF',
  CUSTOM_HOURS: 'CUSTOM_HOURS',
} as const;
export type ScheduleExceptionType = (typeof ScheduleExceptionType)[keyof typeof ScheduleExceptionType];

export const ServiceKind = {
  CONSULTATION: 'CONSULTATION',
  LAB: 'LAB',
  ULTRASOUND: 'ULTRASOUND',
  PROCEDURE: 'PROCEDURE',
  DIAGNOSTICS: 'DIAGNOSTICS',
  OTHER: 'OTHER',
} as const;
export type ServiceKind = (typeof ServiceKind)[keyof typeof ServiceKind];

export const DiscountType = {
  PERCENT: 'PERCENT',
  FIXED: 'FIXED',
} as const;
export type DiscountType = (typeof DiscountType)[keyof typeof DiscountType];

export const InvoiceStatus = {
  DRAFT: 'DRAFT',
  ISSUED: 'ISSUED',
  PARTIALLY_PAID: 'PARTIALLY_PAID',
  PAID: 'PAID',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
} as const;
export type InvoiceStatus = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];

export const PaymentMethod = {
  CASH: 'CASH',
  CARD: 'CARD',
  PAYME: 'PAYME',
  CLICK: 'CLICK',
  UZUM: 'UZUM',
  BALANCE: 'BALANCE',
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

/**
 * The methods that route money through the clinic's acquiring accounts, and so
 * land in the transfer register.
 *
 * BALANCE is deliberately absent. Applying a patient's own deposit moves no
 * money today — it was registered on the day it actually arrived, into that
 * day's register. Counting it again here is counting the same som twice.
 */
export const TRANSFER_METHODS = ['CARD', 'PAYME', 'CLICK', 'UZUM'] as const;
export type TransferMethod = (typeof TRANSFER_METHODS)[number];

export const PaymentStatus = {
  PENDING: 'PENDING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
  VOIDED: 'VOIDED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const BalanceTransactionType = {
  DEPOSIT: 'DEPOSIT',
  WITHDRAWAL: 'WITHDRAWAL',
  INVOICE_APPLY: 'INVOICE_APPLY',
  REFUND_CREDIT: 'REFUND_CREDIT',
  ADJUSTMENT: 'ADJUSTMENT',
} as const;
export type BalanceTransactionType =
  (typeof BalanceTransactionType)[keyof typeof BalanceTransactionType];

export const CashierShiftStatus = {
  OPEN: 'OPEN',
  CLOSED: 'CLOSED',
} as const;
export type CashierShiftStatus = (typeof CashierShiftStatus)[keyof typeof CashierShiftStatus];

export const LabOrderStatus = {
  ORDERED: 'ORDERED',
  SPECIMEN_COLLECTED: 'SPECIMEN_COLLECTED',
  IN_PROGRESS: 'IN_PROGRESS',
  RESULTED: 'RESULTED',
  APPROVED: 'APPROVED',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
} as const;
export type LabOrderStatus = (typeof LabOrderStatus)[keyof typeof LabOrderStatus];

export const ResultFlag = {
  NORMAL: 'NORMAL',
  HIGH: 'HIGH',
  LOW: 'LOW',
  ABNORMAL: 'ABNORMAL',
  CRITICAL_LOW: 'CRITICAL_LOW',
  CRITICAL_HIGH: 'CRITICAL_HIGH',
} as const;
export type ResultFlag = (typeof ResultFlag)[keyof typeof ResultFlag];

/** A result that must reach a clinician now, not when someone next opens the worklist. */
export const CRITICAL_FLAGS: readonly ResultFlag[] = [
  ResultFlag.CRITICAL_LOW,
  ResultFlag.CRITICAL_HIGH,
];

export const Biomaterial = {
  BLOOD: 'BLOOD',
  URINE: 'URINE',
  STOOL: 'STOOL',
  SEMEN: 'SEMEN',
  SMEAR: 'SMEAR',
  CSF: 'CSF',
  SPUTUM: 'SPUTUM',
  FLUID: 'FLUID',
} as const;
export type Biomaterial = (typeof Biomaterial)[keyof typeof Biomaterial];

export const LabCategory = {
  HEMATOLOGY: 'HEMATOLOGY',
  BIOCHEMISTRY: 'BIOCHEMISTRY',
  HORMONES: 'HORMONES',
  COAGULATION: 'COAGULATION',
  IMMUNOLOGY: 'IMMUNOLOGY',
  TUMOR_MARKERS: 'TUMOR_MARKERS',
  VITAMINS: 'VITAMINS',
  URINALYSIS: 'URINALYSIS',
  COPROLOGY: 'COPROLOGY',
  ANDROLOGY: 'ANDROLOGY',
  CYTOLOGY: 'CYTOLOGY',
  MICROBIOLOGY: 'MICROBIOLOGY',
} as const;
export type LabCategory = (typeof LabCategory)[keyof typeof LabCategory];

export const LabValueType = {
  NUMERIC: 'NUMERIC',
  TEXT: 'TEXT',
  ENUM: 'ENUM',
} as const;
export type LabValueType = (typeof LabValueType)[keyof typeof LabValueType];

export const PhysiologicalState = {
  PREGNANCY: 'PREGNANCY',
  PREGNANCY_T1: 'PREGNANCY_T1',
  PREGNANCY_T2: 'PREGNANCY_T2',
  PREGNANCY_T3: 'PREGNANCY_T3',
  FOLLICULAR: 'FOLLICULAR',
  OVULATORY: 'OVULATORY',
  LUTEAL: 'LUTEAL',
  POSTMENOPAUSE: 'POSTMENOPAUSE',
} as const;
export type PhysiologicalState = (typeof PhysiologicalState)[keyof typeof PhysiologicalState];

export const DocumentCategory = {
  ANALYSIS: 'ANALYSIS',
  IMAGING: 'IMAGING',
  DISCHARGE: 'DISCHARGE',
  CONSENT: 'CONSENT',
  OTHER: 'OTHER',
} as const;
export type DocumentCategory = (typeof DocumentCategory)[keyof typeof DocumentCategory];

export const CompensationType = {
  FIXED_SALARY: 'FIXED_SALARY',
  REVENUE_PERCENT: 'REVENUE_PERCENT',
  PER_SERVICE_FEE: 'PER_SERVICE_FEE',
} as const;
export type CompensationType = (typeof CompensationType)[keyof typeof CompensationType];

export const NotificationChannel = {
  SMS: 'SMS',
  TELEGRAM: 'TELEGRAM',
  IN_APP: 'IN_APP',
} as const;
export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel];

export const NotificationStatus = {
  QUEUED: 'QUEUED',
  SENT: 'SENT',
  DELIVERED: 'DELIVERED',
  FAILED: 'FAILED',
} as const;
export type NotificationStatus = (typeof NotificationStatus)[keyof typeof NotificationStatus];

export const NotificationEvent = {
  APPOINTMENT_CREATED: 'APPOINTMENT_CREATED',
  APPOINTMENT_REMINDER_24H: 'APPOINTMENT_REMINDER_24H',
  APPOINTMENT_REMINDER_2H: 'APPOINTMENT_REMINDER_2H',
  APPOINTMENT_CANCELLED: 'APPOINTMENT_CANCELLED',
  QUEUE_TURN_NEAR: 'QUEUE_TURN_NEAR',
  LAB_RESULT_READY: 'LAB_RESULT_READY',
  PAYMENT_RECEIPT: 'PAYMENT_RECEIPT',
  BIRTHDAY: 'BIRTHDAY',
  DEBT_REMINDER: 'DEBT_REMINDER',
  FEEDBACK_REQUEST: 'FEEDBACK_REQUEST',
} as const;
export type NotificationEvent = (typeof NotificationEvent)[keyof typeof NotificationEvent];

export const SubscriptionStatus = {
  TRIAL: 'TRIAL',
  ACTIVE: 'ACTIVE',
  PAST_DUE: 'PAST_DUE',
  CANCELLED: 'CANCELLED',
} as const;
export type SubscriptionStatus = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

export const AuditAction = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  LOGIN: 'LOGIN',
  LOGOUT: 'LOGOUT',
  LOGIN_FAILED: 'LOGIN_FAILED',
  IMPERSONATE: 'IMPERSONATE',
  REFUND: 'REFUND',
  EXPORT: 'EXPORT',
  MERGE: 'MERGE',
  AMEND: 'AMEND',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export const StockMovementType = {
  PURCHASE: 'PURCHASE',
  SALE: 'SALE',
  DEDUCTION: 'DEDUCTION',
  WRITE_OFF: 'WRITE_OFF',
  TRANSFER: 'TRANSFER',
  ADJUSTMENT: 'ADJUSTMENT',
} as const;
export type StockMovementType = (typeof StockMovementType)[keyof typeof StockMovementType];

export const RecordAccessStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  REVOKED: 'REVOKED',
} as const;
export type RecordAccessStatus = (typeof RecordAccessStatus)[keyof typeof RecordAccessStatus];
