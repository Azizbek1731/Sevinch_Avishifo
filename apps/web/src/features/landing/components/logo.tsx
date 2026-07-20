'use client';

import { HeartPulse } from 'lucide-react';
import { cn } from '@/lib/utils';

/** AviShifo brand mark: HeartPulse in a rounded primary square + wordmark. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm shadow-primary/30">
        <HeartPulse className="h-5 w-5" />
      </span>
      <span className="text-lg font-bold tracking-tight text-foreground">AviShifo</span>
    </span>
  );
}
