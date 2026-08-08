import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Below 16px iOS Safari zooms the viewport the instant a field takes focus, so
 * every field primitive here carries a touch floor: `min-h-11` for the box and
 * `max-md:text-base` for the type.
 *
 * Both are written as floors rather than as `md:` overrides on purpose. Call
 * sites already pass unprefixed sizes (`h-8`, `text-lg`), and cn() merges by
 * modifier — a `md:h-9` in this base would survive their `h-8` and silently
 * resize the desktop they were designed against. A floor never conflicts with
 * a caller's height, and the type floor stays scoped to the phone.
 */
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-9 min-h-11 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:min-h-0 max-md:text-base',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

export { Input };
