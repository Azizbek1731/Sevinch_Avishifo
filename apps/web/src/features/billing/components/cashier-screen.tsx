'use client';

import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { useSocketEvent } from '@/hooks/use-socket';
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
  const queryClient = useQueryClient();

  useSocketEvent('invoice.paid', () => {
    void queryClient.invalidateQueries({ queryKey: ['invoices'] });
    void queryClient.invalidateQueries({ queryKey: ['debtors'] });
    void queryClient.invalidateQueries({ queryKey: ['shifts'] });
  });

  return (
    <div className="space-y-4">
      <PageHeader title={t('title')} description={t('subtitle')} />
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
