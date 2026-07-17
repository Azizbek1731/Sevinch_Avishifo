'use client';

import { useTranslations } from 'next-intl';
import { ArrowLeft, UserX } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePermissions, useStaffMember } from '../hooks';
import { CompensationTab } from './compensation-tab';
import { KpiTab } from './kpi-tab';
import { ProfileTab } from './profile-tab';
import { ScheduleTab } from './schedule-tab';

export function StaffDetail({ userId }: { userId: string }) {
  const t = useTranslations('staff');
  const can = usePermissions();
  const query = useStaffMember(userId);

  if (query.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-8 w-96" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const member = query.data ?? null;
  if (!member) {
    return (
      <EmptyState
        icon={UserX}
        title={t('detail.notFound')}
        action={
          <Button variant="outline" asChild>
            <Link href="/staff">
              <ArrowLeft className="mr-1 h-4 w-4" />
              {t('detail.back')}
            </Link>
          </Button>
        }
      />
    );
  }

  const canSchedule = can('schedules.read');
  const canPayroll = can('payroll.read');

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/staff">
            <ArrowLeft className="mr-1 h-4 w-4" />
            {t('detail.back')}
          </Link>
        </Button>
      </div>

      <PageHeader
        title={member.fullName}
        description={member.specialty ?? undefined}
      >
        <Badge variant="secondary">{t(`roles.${member.role}` as never)}</Badge>
        <StatusBadge status={member.status} label={t(`statuses.${member.status}` as never)} />
      </PageHeader>

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">{t('detail.tabs.profile')}</TabsTrigger>
          {canSchedule ? (
            <TabsTrigger value="schedule">{t('detail.tabs.schedule')}</TabsTrigger>
          ) : null}
          {canPayroll ? <TabsTrigger value="kpi">{t('detail.tabs.kpi')}</TabsTrigger> : null}
          {canPayroll ? (
            <TabsTrigger value="compensation">{t('detail.tabs.compensation')}</TabsTrigger>
          ) : null}
        </TabsList>
        <TabsContent value="profile" className="mt-4">
          <ProfileTab member={member} />
        </TabsContent>
        {canSchedule ? (
          <TabsContent value="schedule" className="mt-4">
            <ScheduleTab userId={userId} />
          </TabsContent>
        ) : null}
        {canPayroll ? (
          <TabsContent value="kpi" className="mt-4">
            <KpiTab userId={userId} />
          </TabsContent>
        ) : null}
        {canPayroll ? (
          <TabsContent value="compensation" className="mt-4">
            <CompensationTab userId={userId} />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}
