'use client';

import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { useSocketEvent } from '@/hooks/use-socket';
import { Lock, PackageOpen, ReceiptText, Wallet } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePermission } from '../hooks';
import { ShiftPanel } from './shift-panel';
import { PendingInvoicesTab } from './pending-invoices-tab';
import { DebtorsTab } from './debtors-tab';
import { DepositTab } from './deposit-tab';

export function CashierScreen() {
  const t = useTranslations('cashier');
  const can = usePermission();
  const tb = useTranslations('billing');
  const ts = useTranslations('surgeries');
  const tr = useTranslations('reports');
  const errors = useTranslations('errors');
  const queryClient = useQueryClient();

  useSocketEvent('invoice.paid', () => {
    void queryClient.invalidateQueries({ queryKey: ['invoices'] });
    void queryClient.invalidateQueries({ queryKey: ['debtors'] });
    void queryClient.invalidateQueries({ queryKey: ['shifts'] });
  });

  if (!can('payments.create')) return <EmptyState icon={Lock} title={errors('FORBIDDEN')} />;

  return (
    <div className="space-y-4">
      <PageHeader title={t('title')} description={tb('workspace.description')}>
        <div className="flex flex-wrap items-center gap-2">
          {can('surgery.payout') ? (
            <Button asChild variant="outline">
              <Link href="/surgeries?status=COMPLETED">
                <Wallet className="mr-2 h-4 w-4" />
                {ts('surgeonPayments')}
              </Link>
            </Button>
          ) : null}
          {can('expenses.read') ? (
            <Button asChild variant="outline">
              <Link href="/expenses">
                <Wallet className="mr-2 h-4 w-4" />
                {tb('workspace.expenses')}
              </Link>
            </Button>
          ) : null}
          {can('reports.cash.read') ? (
            <Button asChild variant="outline">
              <Link href="/reports?tab=consumables">
                <PackageOpen className="mr-2 h-4 w-4" />
                {tr('tabs.consumables')}
              </Link>
            </Button>
          ) : null}
          {can('reports.cash.read') ? (
            <Button asChild variant="outline">
              <Link href="/reports">
                <ReceiptText className="mr-2 h-4 w-4" />
                {tb('workspace.reports')}
              </Link>
            </Button>
          ) : null}
        </div>
      </PageHeader>
      <ShiftPanel />
      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">{t('tabs.pending')}</TabsTrigger>
          {can('debts.read') ? (
            <TabsTrigger value="debtors">{t('tabs.debtors')}</TabsTrigger>
          ) : null}
          {can('payments.create') ? (
            <TabsTrigger value="deposit">{t('tabs.deposit')}</TabsTrigger>
          ) : null}
        </TabsList>
        <TabsContent value="pending" className="mt-4">
          <PendingInvoicesTab />
        </TabsContent>
        {can('debts.read') ? (
          <TabsContent value="debtors" className="mt-4">
            <DebtorsTab />
          </TabsContent>
        ) : null}
        {can('payments.create') ? (
          <TabsContent value="deposit" className="mt-4">
            <DepositTab />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}
