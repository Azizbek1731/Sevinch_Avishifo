import { Suspense } from 'react';
import { AmbulatoryPage } from '@/features/ambulatory/components/ambulatory-page';

export default function Page() {
  return (
    <Suspense>
      <AmbulatoryPage />
    </Suspense>
  );
}
