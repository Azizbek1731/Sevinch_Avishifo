import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/page-header';
import { SurgeriesPanel } from '@/features/surgeries/components/surgeries-panel';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const t = await getTranslations('surgeries');
  const { status } = await searchParams;
  const initialStatus =
    status === 'PLANNED' || status === 'COMPLETED' || status === 'CANCELLED' ? status : 'ALL';
  return (
    <div className="space-y-4">
      <PageHeader title={t('title')} description={t('subtitle')} />
      <SurgeriesPanel initialStatus={initialStatus} />
    </div>
  );
}
