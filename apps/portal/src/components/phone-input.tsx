'use client';

import { forwardRef } from 'react';
import { formatNationalPhone } from '@avishifo/shared';

/**
 * Format any partial input as "+998 90 123-45-67" while typing.
 *
 * The digit rules live in @avishifo/shared so the portal and the staff panel
 * can never drift apart — including the subtle one: a leading "998" is only a
 * country code when more than 9 digits were entered, so 99-operator numbers
 * (99 812 34 56) survive.
 */
export function formatPhoneDisplay(raw: string): string {
  const national = formatNationalPhone(raw);
  return national === '' ? '' : `+998 ${national}`;
}

interface PhoneInputProps {
  value: string;
  onChange: (display: string) => void;
  id?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
}

export const PhoneInput = forwardRef<HTMLInputElement, PhoneInputProps>(function PhoneInput(
  { value, onChange, id, autoFocus, disabled, invalid, className = '' },
  ref,
) {
  return (
    <input
      ref={ref}
      id={id}
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      placeholder="+998 90 123-45-67"
      value={value}
      autoFocus={autoFocus}
      disabled={disabled}
      onChange={(e) => onChange(formatPhoneDisplay(e.target.value))}
      className={`h-12 w-full rounded-xl border bg-surface px-4 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:ring-2 disabled:bg-slate-100 ${
        invalid === true
          ? 'border-red-400 focus:border-red-500 focus:ring-red-100'
          : 'border-slate-300 focus:border-brand focus:ring-brand/20'
      } ${className}`}
    />
  );
});
