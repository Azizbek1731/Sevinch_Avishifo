'use client';

import * as React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

const Checkbox = React.forwardRef<
  React.ComponentRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      // The box stays 16px; the pseudo-element widens the hit area to 32px on
      // touch (9px, not 8, because the inset is measured from the padding box
      // inside the 1px border). It deliberately stops short of 44px: every call
      // site wraps this in a <label> whose text is the real target, and those
      // labels stack about 30px apart — a taller box would reach over its
      // neighbour and toggle the wrong row.
      "peer relative h-4 w-4 shrink-0 rounded-sm border border-primary shadow before:absolute before:-inset-[9px] before:content-[''] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground md:before:hidden",
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className={cn('flex items-center justify-center text-current')}>
      <Check className="h-4 w-4" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
