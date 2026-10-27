import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/page-header';
import { SurgeriesPanel } from '@/features/surgeries/components/surgeries-panel';
import type { SurgeryBucket, SurgeryStatus } from '@/features/surgeries/api';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; bucket?: string }>;
}) {
  const t = await getTranslations('surgeries');
  const { status, bucket } = await searchParams;
  const initialStatus: SurgeryStatus | 'ALL' =
    status === 'PLANNED' || status === 'COMPLETED' || status === 'CANCELLED' ? status : 'ALL';
  const initialBucket: SurgeryBucket = bucket === 'archive' ? 'archive' : 'active';
  return (
    <div className="space-y-4">
      <PageHeader title={t('title')} description={t('subtitle')} />
      <SurgeriesPanel initialStatus={initialStatus} initialBucket={initialBucket} />
    </div>
  );
}
