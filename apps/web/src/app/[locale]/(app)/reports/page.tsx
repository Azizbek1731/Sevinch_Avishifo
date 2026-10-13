import { ReportsView } from '@/features/reports/components/reports-view';

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  return <ReportsView initialTab={tab} />;
}
