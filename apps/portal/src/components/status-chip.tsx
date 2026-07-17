import type { AppointmentStatus, InvoiceStatus } from '@avishifo/shared';

export type ChipTone = 'gray' | 'blue' | 'green' | 'amber' | 'red' | 'brand';

const TONE_CLASSES: Record<ChipTone, string> = {
  gray: 'bg-slate-100 text-slate-600',
  blue: 'bg-blue-50 text-blue-700',
  green: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-700',
  red: 'bg-red-50 text-red-700',
  brand: 'bg-brand-light text-brand-dark',
};

export function StatusChip({ label, tone }: { label: string; tone: ChipTone }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]}`}
    >
      {label}
    </span>
  );
}

export const APPOINTMENT_STATUS_CHIP: Record<AppointmentStatus, { label: string; tone: ChipTone }> = {
  SCHEDULED: { label: 'Rejalashtirilgan', tone: 'brand' },
  CONFIRMED: { label: 'Tasdiqlangan', tone: 'blue' },
  CHECKED_IN: { label: 'Qabulxonada', tone: 'blue' },
  IN_QUEUE: { label: 'Navbatda', tone: 'amber' },
  IN_PROGRESS: { label: 'Qabulda', tone: 'amber' },
  COMPLETED: { label: 'Yakunlangan', tone: 'green' },
  NO_SHOW: { label: 'Kelmagan', tone: 'gray' },
  CANCELLED: { label: 'Bekor qilingan', tone: 'red' },
};

export const INVOICE_STATUS_CHIP: Record<InvoiceStatus, { label: string; tone: ChipTone }> = {
  DRAFT: { label: 'Qoralama', tone: 'gray' },
  ISSUED: { label: "To'lanmagan", tone: 'amber' },
  PARTIALLY_PAID: { label: "Qisman to'langan", tone: 'blue' },
  PAID: { label: "To'langan", tone: 'green' },
  CANCELLED: { label: 'Bekor qilingan', tone: 'gray' },
  REFUNDED: { label: 'Qaytarilgan', tone: 'red' },
};
