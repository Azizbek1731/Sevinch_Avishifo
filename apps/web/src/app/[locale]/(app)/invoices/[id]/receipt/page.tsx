import { ReceiptView } from '@/features/billing/components/receipt-view';

export default async function InvoiceReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ReceiptView id={id} />;
}
