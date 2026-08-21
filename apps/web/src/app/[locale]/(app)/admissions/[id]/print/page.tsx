import { AdmissionPrint } from '@/features/admissions/components/admission-print';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdmissionPrint admissionId={id} />;
}
