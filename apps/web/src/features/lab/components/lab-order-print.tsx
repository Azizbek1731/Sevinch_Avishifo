'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowLeft, ExternalLink, FileText, Printer, RotateCw } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { api } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/empty-state';
import { LabPdfDocument } from './lab-pdf-document';

export function LabOrderPrint({ id }: { id: string }) {
  const t = useTranslations('lab');
  const tc = useTranslations('common');
  const locale = useLocale();
  const branchId = useAuthStore((state) => state.activeBranchId);
  const [preview, setPreview] = useState<{ blob: Blob; url: string } | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [previewErrorUrl, setPreviewErrorUrl] = useState<string | null>(null);
  const [printFailed, setPrintFailed] = useState(false);
  const pdfQuery = useQuery({
    queryKey: ['lab', 'order', id, 'pdf', locale, branchId],
    queryFn: async () => (await api.get<Blob>(`/lab-orders/${id}/pdf`, { locale })).data,
    // A report can change after results are entered or signed. Fetch a fresh
    // copy on every visit, then keep that document stable while it is printed.
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });

  useEffect(() => {
    if (!pdfQuery.data || pdfQuery.isFetching || pdfQuery.isError) return;
    const url = URL.createObjectURL(pdfQuery.data);
    setPreview({ blob: pdfQuery.data, url });
    setPrintFailed(false);
    return () => URL.revokeObjectURL(url);
  }, [pdfQuery.data, pdfQuery.isFetching, pdfQuery.isError]);

  // Never leave an earlier result available for printing during a refetch,
  // branch/locale change, or failed request.
  const pdfUrl =
    !pdfQuery.isFetching && !pdfQuery.isError && preview?.blob === pdfQuery.data
      ? preview?.url
      : undefined;
  const ready = Boolean(pdfUrl && loadedUrl === pdfUrl && previewErrorUrl !== pdfUrl);
  const previewFailed = Boolean(pdfUrl && previewErrorUrl === pdfUrl);

  const onDocumentReady = useCallback(() => {
    setLoadedUrl(pdfUrl ?? null);
    setPreviewErrorUrl(null);
  }, [pdfUrl]);
  const onDocumentError = useCallback(() => setPreviewErrorUrl(pdfUrl ?? null), [pdfUrl]);

  const print = (): void => {
    if (!ready) return;
    try {
      setPrintFailed(false);
      // The named A4 print surface contains only the rendered PDF pages.
      window.print();
    } catch {
      setPrintFailed(true);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" asChild>
          <Link href={`/lab/${id}`}>
            <ArrowLeft className="h-4 w-4" />
            {tc('back')}
          </Link>
        </Button>
        <div className="flex flex-wrap gap-2">
          {pdfUrl ? (
            <Button variant="outline" asChild>
              <a href={pdfUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" />
                {t('printOpenPdf')}
              </a>
            </Button>
          ) : null}
          <Button disabled={!ready} onClick={print}>
            <Printer className="h-4 w-4" />
            {tc('print')}
          </Button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">{t('printPdfHint')}</p>

      {pdfQuery.isError ? (
        <EmptyState
          icon={FileText}
          title={t('pdfFailed')}
          action={
            <Button variant="outline" onClick={() => void pdfQuery.refetch()}>
              <RotateCw className="h-4 w-4" />
              {t('printRetry')}
            </Button>
          }
        />
      ) : !pdfUrl ? (
        <div className="space-y-3" role="status">
          <p className="text-sm text-muted-foreground">{t('printPreparing')}</p>
          <Skeleton className="h-[70vh] w-full" />
        </div>
      ) : (
        <>
          {previewFailed || printFailed ? (
            <p
              role="alert"
              className="rounded-md border border-warning/50 bg-warning/5 p-3 text-sm"
            >
              {t(previewFailed ? 'printPreviewFailed' : 'printFailed')}
            </p>
          ) : !ready ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t('printPreparing')}
            </p>
          ) : null}
          <LabPdfDocument
            key={pdfUrl}
            blob={pdfQuery.data!}
            title={t('printFormTitle')}
            onReady={onDocumentReady}
            onError={onDocumentError}
          />
        </>
      )}
    </div>
  );
}
