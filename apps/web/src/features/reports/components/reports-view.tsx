'use client';

import { useTranslations } from 'next-intl';
import {
  Activity,
  Banknote,
  FlaskConical,
  Lock,
  Package,
  Stethoscope,
  Timer,
  TrendingUp,
  Users,
  Wallet,
  Wrench,
} from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuthStore } from '@/stores/auth-store';
import { CommissionsTab } from '@/features/ambulatory/components/commissions-tab';
import { usePermission, useReportFilters } from '../hooks';
import { ReportFilterBar } from './report-filter-bar';
import { ReportTabGroup, ReportToolbar } from './report-ui';
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
import { DoctorActivityTab } from './doctor-activity-tab';
import { DoctorPayGate } from './doctor-pay-gate';

export function ReportsView({ initialTab }: { initialTab?: string }) {
  const t = useTranslations('reports');
  const can = usePermission();
  const role = useAuthStore((s) => s.user?.role);
  const { state, setState, filters } = useReportFilters();

  const canAnalytics = can('reports.read');
  const canCash = can('reports.cash.read');
  const canOwn = can('reports.own.read');
  const canAmbulatoryShare = can('ambulatory.read');
  const isDoctor = role === 'DOCTOR';
  const ownOnly = canOwn && !canAnalytics && !canCash;
  const selectedTab = ownOnly
    ? 'doctor-activity'
    : canCash && (initialTab === 'cashflow' || initialTab === 'consumables')
      ? initialTab
      : canCash
        ? 'cashflow'
        : canAnalytics
          ? 'revenue'
          : 'doctor-activity';

  if (!canAnalytics && !canCash && !canOwn) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('title')} description={t('description')} />
        <EmptyState icon={Lock} title={t('noAccess')} />
      </div>
    );
  }

  const toolbar = (
    <ReportToolbar
      periodFrom={filters.from}
      periodTo={filters.to}
      periodLabel={t('filters.period')}
    >
      <ReportFilterBar state={state} onChange={setState} />
    </ReportToolbar>
  );

  const payTabs = (
    <Tabs defaultValue="doctor-activity">
      <div className="overflow-x-auto pb-1">
        <TabsList className="w-max rounded-xl">
          <TabsTrigger value="doctor-activity" className="gap-1.5">
            <Stethoscope className="h-3.5 w-3.5" />
            {canAnalytics ? t('tabs.doctor-pay') : t('tabs.doctor-activity')}
          </TabsTrigger>
          {canAmbulatoryShare ? (
            <TabsTrigger value="ambulatory-share" className="gap-1.5">
              <Wallet className="h-3.5 w-3.5" />
              {t('tabs.ambulatory-share')}
            </TabsTrigger>
          ) : null}
        </TabsList>
      </div>
      <TabsContent value="doctor-activity" className="mt-5">
        <DoctorActivityTab filters={filters} pickDoctor={canAnalytics} />
      </TabsContent>
      {canAmbulatoryShare ? (
        <TabsContent value="ambulatory-share" className="mt-5">
          <CommissionsTab />
        </TabsContent>
      ) : null}
    </Tabs>
  );

  if (ownOnly) {
    return (
      <div className="space-y-5">
        <PageHeader title={t('title')} description={t('doctorActivity.pageDescription')} />
        {toolbar}
        <DoctorPayGate>{payTabs}</DoctorPayGate>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title={t('title')} description={t('description')} />
      {toolbar}

      <Tabs key={selectedTab} defaultValue={selectedTab} className="space-y-4">
        <div className="overflow-x-auto pb-1">
          <TabsList className="h-auto w-max flex-wrap gap-1 rounded-xl bg-muted/60 p-1.5">
            {canCash ? (
              <ReportTabGroup label={t('navGroups.finance')}>
                <TabsTrigger value="cashflow" className="gap-1.5">
                  <Banknote className="h-3.5 w-3.5" />
                  {t('tabs.cashflow')}
                </TabsTrigger>
                <TabsTrigger value="consumables" className="gap-1.5">
                  <Package className="h-3.5 w-3.5" />
                  {t('tabs.consumables')}
                </TabsTrigger>
              </ReportTabGroup>
            ) : null}

            {canOwn || canAnalytics ? (
              <ReportTabGroup label={t('navGroups.doctor')}>
                <TabsTrigger value="doctor-activity" className="gap-1.5">
                  <Stethoscope className="h-3.5 w-3.5" />
                  {canAnalytics ? t('tabs.doctor-pay') : t('tabs.doctor-activity')}
                </TabsTrigger>
                {canAmbulatoryShare ? (
                  <TabsTrigger value="ambulatory-share" className="gap-1.5">
                    <Wallet className="h-3.5 w-3.5" />
                    {t('tabs.ambulatory-share')}
                  </TabsTrigger>
                ) : null}
              </ReportTabGroup>
            ) : null}

            {canAnalytics ? (
              <ReportTabGroup label={t('navGroups.analytics')}>
                <TabsTrigger value="revenue" className="gap-1.5">
                  <TrendingUp className="h-3.5 w-3.5" />
                  {t('tabs.revenue')}
                </TabsTrigger>
                <TabsTrigger value="flow" className="gap-1.5">
                  <Users className="h-3.5 w-3.5" />
                  {t('tabs.flow')}
                </TabsTrigger>
                <TabsTrigger value="doctors" className="gap-1.5">
                  <Activity className="h-3.5 w-3.5" />
                  {t('tabs.doctors')}
                </TabsTrigger>
                <TabsTrigger value="services" className="gap-1.5">
                  <Wrench className="h-3.5 w-3.5" />
                  {t('tabs.services')}
                </TabsTrigger>
                <TabsTrigger value="queue" className="gap-1.5">
                  <Timer className="h-3.5 w-3.5" />
                  {t('tabs.queue')}
                </TabsTrigger>
                <TabsTrigger value="lab" className="gap-1.5">
                  <FlaskConical className="h-3.5 w-3.5" />
                  {t('tabs.lab')}
                </TabsTrigger>
                <TabsTrigger value="lab-referrals" className="gap-1.5">
                  <FlaskConical className="h-3.5 w-3.5 opacity-70" />
                  {t('tabs.lab-referrals')}
                </TabsTrigger>
                <TabsTrigger value="shifts" className="gap-1.5">
                  <Banknote className="h-3.5 w-3.5 opacity-70" />
                  {t('tabs.shifts')}
                </TabsTrigger>
              </ReportTabGroup>
            ) : null}
          </TabsList>
        </div>

        {canOwn || canAnalytics ? (
          <TabsContent value="doctor-activity" className="mt-0 focus-visible:outline-none">
            {isDoctor ? (
              <DoctorPayGate>
                <DoctorActivityTab filters={filters} pickDoctor={canAnalytics} />
              </DoctorPayGate>
            ) : (
              <DoctorActivityTab filters={filters} pickDoctor={canAnalytics} />
            )}
          </TabsContent>
        ) : null}

        {(canOwn || canAnalytics) && canAmbulatoryShare ? (
          <TabsContent value="ambulatory-share" className="mt-0 focus-visible:outline-none">
            {isDoctor ? (
              <DoctorPayGate>
                <CommissionsTab />
              </DoctorPayGate>
            ) : (
              <CommissionsTab />
            )}
          </TabsContent>
        ) : null}

        {canCash ? (
          <>
            <TabsContent value="cashflow" className="mt-0 focus-visible:outline-none">
              <CashflowTab filters={filters} />
            </TabsContent>
            <TabsContent value="consumables" className="mt-0 focus-visible:outline-none">
              <ConsumablesTab filters={filters} />
            </TabsContent>
          </>
        ) : null}

        {canAnalytics ? (
          <>
            <TabsContent value="revenue" className="mt-0 focus-visible:outline-none">
              <RevenueTab filters={filters} />
            </TabsContent>
            <TabsContent value="flow" className="mt-0 focus-visible:outline-none">
              <PatientFlowTab filters={filters} />
            </TabsContent>
            <TabsContent value="doctors" className="mt-0 focus-visible:outline-none">
              <DoctorsTab filters={filters} />
            </TabsContent>
            <TabsContent value="services" className="mt-0 focus-visible:outline-none">
              <ServicesTab filters={filters} />
            </TabsContent>
            <TabsContent value="queue" className="mt-0 focus-visible:outline-none">
              <QueueTab filters={filters} />
            </TabsContent>
            <TabsContent value="lab" className="mt-0 focus-visible:outline-none">
              <LabTab filters={filters} />
            </TabsContent>
            <TabsContent value="lab-referrals" className="mt-0 focus-visible:outline-none">
              <LabReferralsTab filters={filters} />
            </TabsContent>
            <TabsContent value="shifts" className="mt-0 focus-visible:outline-none">
              <ShiftsTab filters={filters} />
            </TabsContent>
          </>
        ) : null}
      </Tabs>
    </div>
  );
}
