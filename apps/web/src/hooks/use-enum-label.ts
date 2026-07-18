'use client';

import { useTranslations } from 'next-intl';

/**
 * Groups inside the `statuses` message namespace. Every enum value shown to the
 * user must go through this (or <StatusBadge>) — raw enum strings in the UI are
 * an i18n bug.
 */
export type EnumGroup =
  | 'appointment'
  | 'ticket'
  | 'visit'
  | 'invoice'
  | 'payment'
  | 'lab'
  | 'shift'
  | 'user'
  | 'clinic'
  | 'subscription'
  | 'priority'
  | 'role'
  | 'method'
  | 'channel'
  | 'notification'
  | 'gender'
  | 'roomType'
  | 'serviceKind'
  | 'discount'
  | 'compensation'
  | 'exception'
  | 'documentCategory'
  | 'audit'
  | 'bloodGroup';

/** Localized label for an enum value; falls back to the raw value if unmapped. */
export function useEnumLabel(): (group: EnumGroup, value: string | null | undefined) => string {
  const t = useTranslations('statuses');
  return (group, value) => {
    if (!value) return '';
    const key = `${group}.${value}`;
    return t.has(key as never) ? t(key as never) : value;
  };
}

/**
 * Status→group resolution for values whose group is unambiguous, used by
 * <StatusBadge> when no explicit group is given. Ambiguous values (COMPLETED,
 * IN_PROGRESS, CANCELLED, ACTIVE...) share the same translation across groups,
 * so first match wins safely.
 */
const GROUP_ORDER: EnumGroup[] = [
  'appointment',
  'ticket',
  'invoice',
  'lab',
  'payment',
  'shift',
  'user',
  'subscription',
  'priority',
  'notification',
];

export function useStatusLabel(): (status: string) => string {
  const t = useTranslations('statuses');
  return (status) => {
    for (const g of GROUP_ORDER) {
      const key = `${g}.${status}`;
      if (t.has(key as never)) return t(key as never);
    }
    return status;
  };
}
