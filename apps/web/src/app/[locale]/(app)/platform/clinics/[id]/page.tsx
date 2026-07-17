import { ClinicDetailView } from '@/features/superadmin/components/clinic-detail';

export default async function PlatformClinicDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ClinicDetailView clinicId={id} />;
}
