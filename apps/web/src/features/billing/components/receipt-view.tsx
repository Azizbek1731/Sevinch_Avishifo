'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ArrowLeft, Printer, ReceiptText } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { billingApi } from '../api';
import { ReceiptDocument } from './receipt-document';

export function ReceiptView({ id }: { id: string }) {
  const t = useTranslations('billing');
  const tc = useTranslations('common');

  const { data, isLoading } = useQuery({
    // Partial payments, payment reversals and refunds can change this receipt.
    // Always fetch its current values when reopening the page.
    queryKey: ['receipt', id],
    staleTime: 0,
    refetchOnMount: 'always',
    queryFn: async () => (await billingApi.getReceipt(id)).data,
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-xs space-y-3">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!data) {
    return <EmptyState icon={ReceiptText} title={tc('notFound')} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/invoices/${id}`}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            {tc('back')}
          </Link>
        </Button>
        <Button onClick={() => window.print()}>
          <Printer className="mr-1 h-4 w-4" />
          {t('receipt.print')}
        </Button>
      </div>

      {/* Thermal receipt — paper width comes from the clinic's receipt settings. */}
      <div className="mx-auto w-full">
        <ReceiptDocument data={data} />
      </div>
    </div>
  );
}
