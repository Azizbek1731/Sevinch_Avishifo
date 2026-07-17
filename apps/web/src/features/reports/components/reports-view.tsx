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
import { ShiftsTab } from './shifts-tab';

const TABS = ['revenue', 'flow', 'doctors', 'services', 'queue', 'lab', 'shifts'] as const;

export function ReportsView() {
  const t = useTranslations('reports');
  const can = usePermission();
  const { state, setState, filters } = useReportFilters();

  if (!can('reports.read')) {
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

      <Tabs defaultValue="revenue">
        <div className="overflow-x-auto pb-1">
          <TabsList className="w-max">
            {TABS.map((tab) => (
              <TabsTrigger key={tab} value={tab}>
                {t(`tabs.${tab}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

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
        <TabsContent value="shifts" className="mt-4">
          <ShiftsTab filters={filters} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
