import { PatientCardView } from '@/features/patients/components/patient-card';

export default async function PatientCardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PatientCardView patientId={id} />;
}
