'use client';

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/dates';

/** Compact KPI tile used across report tabs. */
export function ReportKpi({
  label,
  value,
  hint,
  icon: Icon,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border bg-card/80 px-4 py-3 shadow-sm backdrop-blur-sm',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        {Icon ? <Icon className="h-4 w-4 shrink-0 text-muted-foreground/80" /> : null}
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Section chrome: title + optional actions, then content. */
export function ReportSection({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('space-y-3 rounded-xl border bg-card/60 p-4 shadow-sm md:p-5', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3 className="text-base font-semibold tracking-tight">{title}</h3>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Sticky filter + period strip. */
export function ReportToolbar({
  periodFrom,
  periodTo,
  periodLabel,
  children,
  className,
}: {
  periodFrom: string;
  periodTo: string;
  periodLabel: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'sticky top-0 z-20 -mx-1 space-y-3 rounded-xl border bg-background/95 px-3 py-3 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/80 md:px-4',
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{periodLabel}</span>
          <span className="mx-2 text-border">·</span>
          <span className="tabular-nums">
            {formatDate(periodFrom)}
            {periodFrom !== periodTo ? ` – ${formatDate(periodTo)}` : ''}
          </span>
        </p>
      </div>
      {children}
    </div>
  );
}

export function ReportTabGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="hidden px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80 lg:inline">
        {label}
      </span>
      {children}
    </div>
  );
}
