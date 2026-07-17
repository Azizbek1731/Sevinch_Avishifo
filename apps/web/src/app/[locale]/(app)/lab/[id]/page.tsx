import { LabOrderDetail } from '@/features/lab/components/lab-order-detail';

export default async function LabOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <LabOrderDetail id={id} />;
}
