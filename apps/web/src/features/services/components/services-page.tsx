'use client';

import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DiscountsTab } from './discounts-tab';
import { PackagesTab } from './packages-tab';
import { ServicesTab } from './services-tab';

export function ServicesPage() {
  const t = useTranslations('services');

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('subtitle')} />

      <Tabs defaultValue="services">
        <TabsList>
          <TabsTrigger value="services">{t('tabs.services')}</TabsTrigger>
          <TabsTrigger value="packages">{t('tabs.packages')}</TabsTrigger>
          <TabsTrigger value="discounts">{t('tabs.discounts')}</TabsTrigger>
        </TabsList>
        <TabsContent value="services" className="mt-4">
          <ServicesTab />
        </TabsContent>
        <TabsContent value="packages" className="mt-4">
          <PackagesTab />
        </TabsContent>
        <TabsContent value="discounts" className="mt-4">
          <DiscountsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
