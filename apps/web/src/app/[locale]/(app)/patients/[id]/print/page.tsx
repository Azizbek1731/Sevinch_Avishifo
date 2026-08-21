import { PatientCardPrint } from '@/features/patients/components/patient-card-print';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PatientCardPrint patientId={id} />;
}
