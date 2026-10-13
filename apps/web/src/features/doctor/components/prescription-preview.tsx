'use client';

import { useTranslations } from 'next-intl';
import {
  formatPrescriptionGroup,
  groupPrescriptionItems,
  type PrescriptionFormatItem,
} from '@avishifo/shared';

/** The same structured formatter is used by the browser report and server PDF. */
export function PrescriptionPreview({
  items,
  compact = false,
}: {
  items: readonly PrescriptionFormatItem[];
  compact?: boolean;
}) {
  const t = useTranslations('visits');
  const groups = groupPrescriptionItems(items);
  return (
    <ol className={compact ? 'space-y-2' : 'space-y-4'}>
      {groups.map((group, index) => {
        const lines = formatPrescriptionGroup(group, {
          days: (count) => t('days', { count }),
          dripUnit: t('rx.dripUnit'),
        });
        return (
          <li key={index} className="flex gap-3 break-inside-avoid text-sm">
            <span className="pt-0.5 font-semibold text-muted-foreground">{index + 1}.</span>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="break-words font-medium">
                <span className="mr-1 font-bold text-primary">Rp.:</span>
                {lines.components.map((name, component) => (
                  <span key={component} className={component ? 'mt-1 block pl-8' : ''}>
                    {component ? '+ ' : ''}
                    {name || '…'}
                  </span>
                ))}
              </div>
              {lines.dtd ? <p className="break-words text-muted-foreground">{lines.dtd}</p> : null}
              {lines.signature ? (
                <p className="whitespace-pre-wrap break-words">
                  <strong>S.</strong> {lines.signature}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
