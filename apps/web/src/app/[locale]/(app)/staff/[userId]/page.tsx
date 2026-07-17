import { StaffDetail } from '@/features/staff/components/staff-detail';

export default async function StaffDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  return <StaffDetail userId={userId} />;
}
