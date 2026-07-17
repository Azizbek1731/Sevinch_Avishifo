import { LabOrderPrint } from '@/features/lab/components/lab-order-print';

export default async function LabOrderPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <LabOrderPrint id={id} />;
}
