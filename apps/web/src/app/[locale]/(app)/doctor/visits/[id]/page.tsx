import { VisitForm } from '@/features/doctor/components/visit-form';

export default async function VisitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VisitForm visitId={id} />;
}
