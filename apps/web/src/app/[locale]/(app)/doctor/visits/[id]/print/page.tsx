import { Suspense } from 'react';
import { VisitPrint } from '@/features/doctor/components/visit-print';

export default async function VisitPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <VisitPrint visitId={id} />
    </Suspense>
  );
}
