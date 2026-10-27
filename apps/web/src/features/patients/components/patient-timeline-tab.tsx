'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  ClipboardList,
  CreditCard,
  FileText,
  FlaskConical,
  History,
  Pill,
  Stethoscope,
  type LucideIcon,
} from 'lucide-react';
import { formatUZS } from '@avishifo/shared';
import { Link } from '@/i18n/routing';
import { useEnumLabel } from '@/hooks/use-enum-label';
import { EmptyState } from '@/components/empty-state';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatTz } from '@/lib/dates';
import { localizedText, type Localizable } from '@/lib/localized';
import { TIMELINE_TYPES, type TimelineItem, type TimelineType } from '../api';
import { usePatientTimeline } from '../hooks';

const TYPE_ICONS: Record<TimelineType, LucideIcon> = {
  visit: Stethoscope,
  diagnosis: ClipboardList,
  prescription: Pill,
  lab: FlaskConical,
  document: FileText,
  payment: CreditCard,
};

const str = (d: Record<string, unknown>, k: string): string | null =>
  typeof d[k] === 'string' ? (d[k] as string) : null;

function ItemDetails({ item }: { item: TimelineItem }) {
  const t = useTranslations('patients');
  const locale = useLocale();
  const enumLabel = useEnumLabel();
  const d = item.data;

  if (item.type === 'visit') {
    const visitId = str(d, 'visitId');
    const status = str(d, 'status');
    const statusKey = status ? (`visitStatus.${status}` as const) : null;
    return (
      <div className="flex flex-wrap items-center gap-2">
        {status ? (
          <StatusBadge
            status={status}
            label={statusKey && t.has(statusKey) ? t(statusKey) : status}
          />
        ) : null}
        {visitId ? (
          <Button asChild variant="link" size="sm" className="h-auto p-0">
            <Link href={`/doctor/visits/${visitId}`}>{t('timeline.openVisit')}</Link>
          </Button>
        ) : null}
      </div>
    );
  }
  if (item.type === 'payment') {
    const amount = str(d, 'amount');
    const method = str(d, 'method');
    return (
      <p className="text-sm text-muted-foreground">
        {amount ? formatUZS(amount) : null}
        {method ? ` · ${enumLabel('method', method)}` : null}
      </p>
    );
  }
  if (item.type === 'lab') {
    const status = str(d, 'status');
    const tests = Array.isArray(d['tests'])
      ? (d['tests'] as Array<{ name?: Localizable; code?: string }>)
      : [];
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {status ? <StatusBadge status={status} /> : null}
        {tests.slice(0, 4).map((x, i) => {
          const label = localizedText(x.name, locale, x.code ?? '');
          return label ? (
            <Badge key={i} variant="secondary" className="text-xs">
              {label}
            </Badge>
          ) : null;
        })}
      </div>
    );
  }
  if (item.type === 'document') {
    const fileName = str(d, 'fileName');
    return fileName ? <p className="text-sm text-muted-foreground">{fileName}</p> : null;
  }
  if (item.type === 'prescription') {
    const dosage = str(d, 'dosage');
    const frequency = str(d, 'frequency');
    return dosage || frequency ? (
      <p className="text-sm text-muted-foreground">
        {[dosage, frequency].filter(Boolean).join(' · ')}
      </p>
    ) : null;
  }
  if (item.type === 'diagnosis') {
    const note = str(d, 'note');
    return note ? <p className="text-sm text-muted-foreground">{note}</p> : null;
  }
  return null;
}

export function PatientTimelineTab({ patientId }: { patientId: string }) {
  const t = useTranslations('patients');
  const [type, setType] = useState<TimelineType | undefined>(undefined);

  const query = usePatientTimeline(patientId, type);
  const items = query.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <div className="space-y-4">
      {/* Type filter chips */}
      <div className="flex flex-wrap gap-1.5">
        <Button
          size="sm"
          variant={type === undefined ? 'default' : 'outline'}
          onClick={() => setType(undefined)}
        >
          {t('timeline.all')}
        </Button>
        {TIMELINE_TYPES.map((tt) => (
          <Button
            key={tt}
            size="sm"
            variant={type === tt ? 'default' : 'outline'}
            onClick={() => setType(tt)}
          >
            {t(`timeline.${tt}` as never)}
          </Button>
        ))}
      </div>

      {query.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={History} title={t('timeline.empty')} />
      ) : (
        <ol className="relative space-y-4 border-l pl-6">
          {items.map((item, i) => {
            const Icon = TYPE_ICONS[item.type] ?? History;
            return (
              <li key={`${item.type}-${item.at}-${i}`} className="relative">
                <span className="absolute -left-[35px] flex h-6 w-6 items-center justify-center rounded-full border bg-card">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                </span>
                <div className="rounded-md border bg-card px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">{item.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatTz(item.at)} ·{' '}
                      {t.has(`timeline.${item.type}` as never)
                        ? t(`timeline.${item.type}` as never)
                        : item.type}
                    </p>
                  </div>
                  <div className="mt-1">
                    <ItemDetails item={item} />
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {query.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => void query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
          >
            {t('timeline.loadMore')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
