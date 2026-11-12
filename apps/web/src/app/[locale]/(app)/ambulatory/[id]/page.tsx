import { CaseDetail } from '@/features/ambulatory/components/case-detail';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CaseDetail caseId={id} />;
}
