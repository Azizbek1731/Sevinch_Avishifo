'use client';

import * as React from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';
import { DayPicker } from 'react-day-picker';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('p-3', className)}
      classNames={{
        months: 'relative flex flex-col gap-4 sm:flex-row',
        month: 'space-y-4',
        month_caption: 'flex h-11 items-center justify-center md:h-9',
        caption_label: 'text-sm font-medium',
        nav: 'absolute inset-x-0 top-0 z-10 flex h-11 items-center justify-between px-1 md:h-9',
        // Every square below is sized on both axes because buttonVariants now
        // carries a 44px touch floor: a lone `h-7` would leave the button tall
        // and narrow on a phone. Seven 44px columns plus p-3 come to 332px,
        // which still clears a 375px viewport.
        button_previous: cn(
          buttonVariants({ variant: 'outline' }),
          'h-11 w-11 bg-transparent p-0 opacity-50 hover:opacity-100 md:h-7 md:w-7',
        ),
        button_next: cn(
          buttonVariants({ variant: 'outline' }),
          'h-11 w-11 bg-transparent p-0 opacity-50 hover:opacity-100 md:h-7 md:w-7',
        ),
        month_grid: 'w-full border-collapse space-y-1',
        weekdays: 'flex',
        weekday: 'w-11 rounded-md text-[0.8rem] font-normal text-muted-foreground md:w-9',
        week: 'mt-2 flex w-full',
        day: cn(
          'relative h-11 w-11 p-0 text-center text-sm focus-within:relative focus-within:z-20 md:h-9 md:w-9',
          '[&:has([data-selected])]:rounded-md [&:has([data-selected])]:bg-primary',
        ),
        day_button: cn(
          buttonVariants({ variant: 'ghost' }),
          'h-11 w-11 p-0 font-normal aria-selected:opacity-100 md:h-9 md:w-9',
        ),
        range_start: 'rounded-l-md',
        range_middle: 'rounded-none',
        range_end: 'rounded-r-md',
        selected:
          'rounded-md bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground',
        today: 'rounded-md bg-accent text-accent-foreground',
        outside: 'text-muted-foreground opacity-50',
        disabled: 'text-muted-foreground opacity-50',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: chevronClassName }) => {
          const Icon =
            orientation === 'left'
              ? ChevronLeft
              : orientation === 'right'
                ? ChevronRight
                : orientation === 'up'
                  ? ChevronUp
                  : ChevronDown;
          return <Icon className={cn('h-4 w-4', chevronClassName)} />;
        },
      }}
      {...props}
    />
  );
}
Calendar.displayName = 'Calendar';

export { Calendar };
