import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type StatusTone = 'green' | 'blue' | 'amber' | 'red' | 'gray';

const TONE_CLASSES: Record<StatusTone, string> = {
  green: 'border-transparent bg-success/15 text-success',
  blue: 'border-transparent bg-primary/10 text-primary',
  amber: 'border-transparent bg-warning/15 text-warning-foreground dark:text-warning',
  red: 'border-transparent bg-destructive/10 text-destructive',
  gray: 'border-transparent bg-muted text-muted-foreground',
};

const STATUS_TONES: Record<string, StatusTone> = {
  // Appointments
  SCHEDULED: 'blue',
  CONFIRMED: 'green',
  CHECKED_IN: 'blue',
  IN_QUEUE: 'amber',
  IN_PROGRESS: 'blue',
  COMPLETED: 'green',
  NO_SHOW: 'red',
  CANCELLED: 'red',
  // Queue
  WAITING: 'amber',
  CALLED: 'blue',
  IN_ROOM: 'blue',
  DONE: 'green',
  SKIPPED: 'gray',
  // Invoices
  DRAFT: 'gray',
  ISSUED: 'blue',
  PARTIALLY_PAID: 'amber',
  PAID: 'green',
  REFUNDED: 'gray',
  // Lab orders
  ORDERED: 'blue',
  SPECIMEN_COLLECTED: 'amber',
  RESULTED: 'blue',
  APPROVED: 'green',
  DELIVERED: 'green',
  // Generic / platform
  OPEN: 'blue',
  CLOSED: 'gray',
  ACTIVE: 'green',
  SUSPENDED: 'red',
};

export interface StatusBadgeProps {
  status: string;
  /** Overrides the rendered text; defaults to the raw status string. */
  label?: string;
  className?: string;
}

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const tone: StatusTone = STATUS_TONES[status] ?? 'gray';
  return (
    <Badge variant="outline" className={cn('font-medium', TONE_CLASSES[tone], className)}>
      {label ?? status}
    </Badge>
  );
}
