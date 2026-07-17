'use client';

import { forwardRef } from 'react';

/**
 * Format any partial input as "+998 90 123-45-67" while typing.
 * A leading "998" is stripped only when it is clearly a country code
 * (explicit "+" or more than 9 digits), so numbers of the 99-operator survive.
 */
export function formatPhoneDisplay(raw: string): string {
  const hadPlus = raw.trim().startsWith('+');
  let digits = raw.replace(/\D/g, '');
  if ((hadPlus || digits.length > 9) && digits.startsWith('998')) digits = digits.slice(3);
  digits = digits.slice(0, 9);
  if (digits.length === 0) return '';
  let out = `+998 ${digits.slice(0, 2)}`;
  if (digits.length > 2) out += ` ${digits.slice(2, 5)}`;
  if (digits.length > 5) out += `-${digits.slice(5, 7)}`;
  if (digits.length > 7) out += `-${digits.slice(7, 9)}`;
  return out;
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
      className={`h-12 w-full rounded-xl border bg-white px-4 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:ring-2 disabled:bg-slate-100 ${
        invalid === true
          ? 'border-red-400 focus:border-red-500 focus:ring-red-100'
          : 'border-slate-300 focus:border-brand focus:ring-brand/20'
      } ${className}`}
    />
  );
});
