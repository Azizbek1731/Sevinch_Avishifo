import { AdmissionDetail } from '@/features/admissions/components/admission-detail';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdmissionDetail admissionId={id} />;
}
