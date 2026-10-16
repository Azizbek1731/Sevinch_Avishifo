'use client';

import { useTranslations } from 'next-intl';
import { Lock } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePermission, useReportFilters } from '../hooks';
import { ReportFilterBar } from './report-filter-bar';
import { RevenueTab } from './revenue-tab';
import { PatientFlowTab } from './patient-flow-tab';
import { DoctorsTab } from './doctors-tab';
import { ServicesTab } from './services-tab';
import { QueueTab } from './queue-tab';
import { LabTab } from './lab-tab';
import { LabReferralsTab } from './lab-referrals-tab';
import { CashflowTab } from './cashflow-tab';
import { ConsumablesTab } from './consumables-tab';
import { ShiftsTab } from './shifts-tab';

const TABS = [
  'revenue',
  'flow',
  'doctors',
  'services',
  'queue',
  'lab',
  'lab-referrals',
  'shifts',
] as const;

export function ReportsView({ initialTab }: { initialTab?: string }) {
  const t = useTranslations('reports');
  const can = usePermission();
  const { state, setState, filters } = useReportFilters();

  const canAnalytics = can('reports.read');
  const canCash = can('reports.cash.read');
  const tabs = canAnalytics ? TABS : [];
  const selectedTab =
    canCash && (initialTab === 'cashflow' || initialTab === 'consumables')
      ? initialTab
      : canCash
        ? 'cashflow'
        : 'revenue';

  if (!canAnalytics && !canCash) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('title')} description={t('description')} />
        <EmptyState icon={Lock} title={t('noAccess')} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('description')} />

      <ReportFilterBar state={state} onChange={setState} />

      <Tabs key={selectedTab} defaultValue={selectedTab}>
        <div className="overflow-x-auto pb-1">
          <TabsList className="w-max">
            {canCash && <TabsTrigger value="cashflow">{t('tabs.cashflow')}</TabsTrigger>}
            {canCash && <TabsTrigger value="consumables">{t('tabs.consumables')}</TabsTrigger>}
            {tabs.map((tab) => (
              <TabsTrigger key={tab} value={tab}>
                {t(`tabs.${tab}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {canCash && (
          <>
            <TabsContent value="cashflow" className="mt-4">
              <CashflowTab filters={filters} />
            </TabsContent>
            <TabsContent value="consumables" className="mt-4">
              <ConsumablesTab filters={filters} />
            </TabsContent>
          </>
        )}
        {canAnalytics && (
          <>
            <TabsContent value="revenue" className="mt-4">
              <RevenueTab filters={filters} />
            </TabsContent>
            <TabsContent value="flow" className="mt-4">
              <PatientFlowTab filters={filters} />
            </TabsContent>
            <TabsContent value="doctors" className="mt-4">
              <DoctorsTab filters={filters} />
            </TabsContent>
            <TabsContent value="services" className="mt-4">
              <ServicesTab filters={filters} />
            </TabsContent>
            <TabsContent value="queue" className="mt-4">
              <QueueTab filters={filters} />
            </TabsContent>
            <TabsContent value="lab" className="mt-4">
              <LabTab filters={filters} />
            </TabsContent>
            <TabsContent value="lab-referrals" className="mt-4">
              <LabReferralsTab filters={filters} />
            </TabsContent>
            <TabsContent value="shifts" className="mt-4">
              <ShiftsTab filters={filters} />
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}
