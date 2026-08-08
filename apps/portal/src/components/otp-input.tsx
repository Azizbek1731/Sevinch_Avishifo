'use client';

import { useRef } from 'react';

const LENGTH = 6;

interface OtpInputProps {
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}

/** 6 separate digit boxes with auto-advance, backspace and paste support. */
export function OtpInput({ value, onChange, disabled, autoFocus }: OtpInputProps) {
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  const focusIndex = (i: number) => {
    const el = inputsRef.current[Math.min(Math.max(i, 0), LENGTH - 1)];
    el?.focus();
    el?.select();
  };

  const handleChange = (index: number, raw: string) => {
    const typed = raw.replace(/\D/g, '');
    if (typed === '') return;
    const next = (value.slice(0, index) + typed).slice(0, LENGTH);
    onChange(next);
    focusIndex(next.length);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      const next = value.slice(0, -1);
      onChange(next);
      focusIndex(next.length);
    }
  };

  return (
    <div className="flex justify-between gap-2" role="group" aria-label="Tasdiqlash kodi">
      {Array.from({ length: LENGTH }, (_, i) => (
        <input
          key={i}
          ref={(el) => {
            inputsRef.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={LENGTH}
          value={value[i] ?? ''}
          disabled={disabled}
          autoFocus={autoFocus === true && i === 0}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={(e) => e.target.select()}
          className="h-14 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white py-3 text-center text-xl font-semibold text-slate-900 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:bg-slate-100"
        />
      ))}
    </div>
  );
}
