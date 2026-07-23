'use client';

import { useTranslations } from 'next-intl';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/page-header';
import { BranchesTab } from './branches-tab';
import { ClinicTab } from './clinic-tab';
import { LogsTab } from './logs-tab';
import { ReceiptTab } from './receipt-tab';
import { TemplatesTab } from './templates-tab';
import { UsersTab } from './users-tab';

export function SettingsPage() {
  const t = useTranslations('settings');

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('description')} />
      <Tabs defaultValue="clinic">
        <TabsList className="flex-wrap">
          <TabsTrigger value="clinic">{t('tabs.clinic')}</TabsTrigger>
          <TabsTrigger value="branches">{t('tabs.branches')}</TabsTrigger>
          <TabsTrigger value="receipt">{t('tabs.receipt')}</TabsTrigger>
          <TabsTrigger value="users">{t('tabs.users')}</TabsTrigger>
          <TabsTrigger value="templates">{t('tabs.templates')}</TabsTrigger>
          <TabsTrigger value="logs">{t('tabs.logs')}</TabsTrigger>
        </TabsList>
        <TabsContent value="clinic" className="mt-4">
          <ClinicTab />
        </TabsContent>
        <TabsContent value="receipt" className="mt-4">
          <ReceiptTab />
        </TabsContent>
        <TabsContent value="branches" className="mt-4">
          <BranchesTab />
        </TabsContent>
        <TabsContent value="users" className="mt-4">
          <UsersTab />
        </TabsContent>
        <TabsContent value="templates" className="mt-4">
          <TemplatesTab />
        </TabsContent>
        <TabsContent value="logs" className="mt-4">
          <LogsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
