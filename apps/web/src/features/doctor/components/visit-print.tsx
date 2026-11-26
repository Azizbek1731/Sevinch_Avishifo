'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ArrowLeft, ExternalLink, FileText, Printer, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/empty-state';
import { PdfDocument } from '@/components/print/pdf-document';
import { Link } from '@/i18n/routing';
import { api } from '@/lib/api-client';
import { filenameFromContentDisposition } from '@/lib/download-filename';
import { markPdfPrinted, usePdfPrinted } from '@/lib/pdf-printed';
import { useAuthStore } from '@/stores/auth-store';

/**
 * Same A4 PDF the lab uses — letterhead + Made with AviShifo.uz footer.
 * `pdfPath` / `backHref` let the ambulatory card serve the report to desks without visits.read.
 */
export function VisitPrint({
  visitId,
  pdfPath = `/visits/${visitId}/pdf`,
  backHref = `/doctor/visits/${visitId}`,
}: {
  visitId: string;
  pdfPath?: string;
  backHref?: string;
}) {
  const t = useTranslations('visits');
  const tCommon = useTranslations('common');
  const tr = useTranslations('doctor.clinical');
  const searchParams = useSearchParams();
  const mode = searchParams.get('mode') === 'prescription' ? 'prescription' : 'summary';
  const auto = searchParams.get('auto') === '1';
  const branchId = useAuthStore((state) => state.activeBranchId);
  const [preview, setPreview] = useState<{ blob: Blob; url: string; filename: string } | null>(
    null,
  );
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [previewErrorUrl, setPreviewErrorUrl] = useState<string | null>(null);
  const [printFailed, setPrintFailed] = useState(false);
  const [autoPrinted, setAutoPrinted] = useState(false);
  const pdfPrinted = usePdfPrinted('visit', visitId);

  const pdfQuery = useQuery({
    queryKey: ['visits', visitId, 'pdf', mode, branchId, pdfPath],
    queryFn: async () => {
      const response = await api.get<Blob>(pdfPath, {
        mode: mode === 'prescription' ? 'prescription' : undefined,
      });
      const fallback =
        mode === 'prescription' ? 'Retsept.pdf' : 'Klinik_xulosa.pdf';
      return {
        blob: response.data,
        filename: filenameFromContentDisposition(
          response.headers?.get('content-disposition'),
          fallback,
        ),
      };
    },
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });

  useEffect(() => {
    if (!pdfQuery.data || pdfQuery.isFetching || pdfQuery.isError) return;
    const url = URL.createObjectURL(pdfQuery.data.blob);
    setPreview({ blob: pdfQuery.data.blob, url, filename: pdfQuery.data.filename });
    setPrintFailed(false);
    return () => URL.revokeObjectURL(url);
  }, [pdfQuery.data, pdfQuery.isFetching, pdfQuery.isError]);

  const pdfUrl =
    !pdfQuery.isFetching && !pdfQuery.isError && preview?.blob === pdfQuery.data?.blob
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
      window.print();
      if (mode === 'summary') markPdfPrinted('visit', visitId);
    } catch {
      setPrintFailed(true);
    }
  };

  useEffect(() => {
    if (!auto || !ready || autoPrinted) return;
    const timer = window.setTimeout(() => {
      setAutoPrinted(true);
      print();
    }, 300);
    return () => window.clearTimeout(timer);
    // print closes over ready; auto-print once when the PDF pages decode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, ready, autoPrinted]);

  const title = mode === 'prescription' ? t('printPrescriptionTitle') : t('printSummaryTitle');

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Button variant="ghost" asChild>
          <Link href={backHref}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {tCommon('back')}
          </Link>
        </Button>
        <div className="flex flex-wrap gap-2">
          {pdfUrl && preview ? (
            <Button variant="outline" asChild>
              <a href={pdfUrl} download={preview.filename}>
                <ExternalLink className="mr-2 h-4 w-4" />
                {t('printOpenPdf')}
              </a>
            </Button>
          ) : null}
          <Button
            disabled={!ready}
            onClick={print}
            variant={mode === 'summary' && pdfPrinted.printed ? 'default' : undefined}
            className={mode === 'summary' ? pdfPrinted.className : undefined}
            title={mode === 'summary' && pdfPrinted.printed ? t('pdfPrinted') : undefined}
          >
            <Printer className="mr-2 h-4 w-4" />
            {tCommon('print')}
          </Button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground print:hidden">{t('printPdfHint')}</p>

      {pdfQuery.isError ? (
        <EmptyState
          icon={FileText}
          title={t('pdfFailed')}
          description={tr('confirmBeforePrint')}
          action={
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => void pdfQuery.refetch()}>
                <RotateCw className="mr-2 h-4 w-4" />
                {t('printRetry')}
              </Button>
              <Button variant="outline" asChild>
                <Link href={backHref}>{tCommon('back')}</Link>
              </Button>
            </div>
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
              className="rounded-md border border-warning/50 bg-warning/5 p-3 text-sm print:hidden"
            >
              {t(previewFailed ? 'printPreviewFailed' : 'printFailed')}
            </p>
          ) : !ready ? (
            <p role="status" className="text-sm text-muted-foreground print:hidden">
              {t('printPreparing')}
            </p>
          ) : null}
          <PdfDocument
            key={pdfUrl}
            blob={pdfQuery.data!.blob}
            title={title}
            onReady={onDocumentReady}
            onError={onDocumentError}
          />
        </>
      )}
    </div>
  );
}
