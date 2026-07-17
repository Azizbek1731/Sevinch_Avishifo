import { Loader2 } from 'lucide-react';

export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return <Loader2 aria-label="Yuklanmoqda" className={`animate-spin text-brand ${className}`} />;
}

/** Centered full-section loader. */
export function PageLoader() {
  return (
    <div className="flex justify-center py-16">
      <Spinner className="h-8 w-8" />
    </div>
  );
}
