'use client';

import * as React from 'react';
import { formatNationalPhone, toNationalDigits } from '@avishifo/shared';
import { cn } from '@/lib/utils';

/**
 * Strict Uzbek phone field: a fixed `+998` prefix and a `XX XXX-XX-XX` mask.
 * Non-digits are dropped as you type and the national part is capped at 9, so a
 * malformed number cannot be entered at all.
 *
 * Drop-in for react-hook-form: spread `register(name, { setValueAs: phoneWireValue })`
 * — this component masks the DOM value, and setValueAs turns it into +998XXXXXXXXX.
 */
const PhoneInput = React.forwardRef<
  HTMLInputElement,
  Omit<React.ComponentProps<'input'>, 'type' | 'placeholder'>
>(({ className, onChange, defaultValue, value, ...props }, ref) => {
  const mask = (el: HTMLInputElement): void => {
    const before = el.value;
    const masked = formatNationalPhone(before);
    if (masked !== before) {
      el.value = masked;
      // Typing always appends here, so parking the caret at the end avoids the
      // classic mask jump without tracking selection offsets.
      el.setSelectionRange(masked.length, masked.length);
    }
  };

  return (
    <div className={cn('relative', className)}>
      <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-sm text-muted-foreground max-md:text-base">
        +998
      </span>
      <input
        ref={ref}
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        placeholder="90 123-45-67"
        defaultValue={defaultValue === undefined ? undefined : formatNationalPhone(String(defaultValue))}
        value={value === undefined ? undefined : formatNationalPhone(String(value))}
        onChange={(e) => {
          mask(e.currentTarget);
          onChange?.(e);
        }}
        onPaste={(e) => {
          // Let the paste land, then re-mask (handles "+998 90 123 45 67").
          const el = e.currentTarget;
          window.setTimeout(() => {
            el.value = formatNationalPhone(el.value);
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }, 0);
        }}
        onKeyDown={(e) => {
          // Block obvious non-digit typing early so the field never flickers.
          if (
            e.key.length === 1 &&
            !e.ctrlKey &&
            !e.metaKey &&
            !/\d/.test(e.key)
          ) {
            e.preventDefault();
            return;
          }
          if (/\d/.test(e.key) && toNationalDigits(e.currentTarget.value).length >= 9) {
            const el = e.currentTarget;
            // Allow overwriting a selection, block appending past 9 digits.
            if (el.selectionStart === el.selectionEnd) e.preventDefault();
          }
        }}
        // The left padding clears the fixed prefix, which is wider at 16px.
        className="flex h-9 min-h-11 w-full rounded-md border border-input bg-transparent py-1 pl-[3.25rem] pr-3 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:min-h-0 max-md:pl-14 max-md:text-base"
        {...props}
      />
    </div>
  );
});
PhoneInput.displayName = 'PhoneInput';

export { PhoneInput };
