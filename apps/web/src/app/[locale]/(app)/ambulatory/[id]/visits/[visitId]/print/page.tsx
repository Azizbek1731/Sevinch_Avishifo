import { Suspense } from 'react';
import { VisitPrint } from '@/features/doctor/components/visit-print';

export default async function AmbulatoryVisitPrintPage({
  params,
}: {
  params: Promise<{ id: string; visitId: string }>;
}) {
  const { id, visitId } = await params;
  return (
    <Suspense>
      <VisitPrint
        visitId={visitId}
        pdfPath={`/ambulatory/${id}/visits/${visitId}/pdf`}
        backHref={`/ambulatory/${id}`}
      />
    </Suspense>
  );
}
