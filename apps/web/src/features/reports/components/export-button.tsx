'use client';

import type { Permission } from '@avishifo/shared';
import { useTranslations } from 'next-intl';
import { Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ReportFilters } from '../api';
import { useExportXlsx, usePermission } from '../hooks';

export interface ExportButtonProps {
  /** Report endpoint path, e.g. "/reports/revenue". */
  path: string;
  /** Filename prefix, e.g. "revenue" → revenue_2026-07-01_2026-07-18.xlsx. */
  filenameBase: string;
  filters: ReportFilters;
  /** Extra query params (e.g. revenue dimension). */
  extra?: Record<string, string>;
  permission?: Permission;
}

export function ExportButton({
  path,
  filenameBase,
  filters,
  extra,
  permission = 'reports.export',
}: ExportButtonProps) {
  const t = useTranslations('reports');
  const can = usePermission();
  const exportXlsx = useExportXlsx(path, filenameBase, filters, extra);

  if (!can(permission)) return null;

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={exportXlsx.isPending}
      onClick={() => exportXlsx.mutate()}
    >
      {exportXlsx.isPending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Download className="h-4 w-4" />
      )}
      {t('export.xlsx')}
    </Button>
  );
}
