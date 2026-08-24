'use client';

import { useRef } from 'react';

const LENGTH = 6;

interface OtpInputProps {
  value: string;
  onChange: (code: string) => void;
  /** Fired once the sixth digit lands — typed, pasted or autofilled. */
  onComplete?: (code: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}

/** 6 separate digit boxes with auto-advance, backspace and paste support. */
export function OtpInput({ value, onChange, onComplete, disabled, autoFocus }: OtpInputProps) {
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  const focusIndex = (i: number) => {
    const el = inputsRef.current[Math.min(Math.max(i, 0), LENGTH - 1)];
    el?.focus();
    el?.select();
  };

  const commit = (next: string) => {
    onChange(next);
    focusIndex(next.length);
    if (next.length === LENGTH) onComplete?.(next);
  };

  const handleChange = (index: number, raw: string) => {
    const typed = raw.replace(/\D/g, '');
    if (typed === '') return;
    // Overwrite from this box onwards: one digit replaces one digit, while a
    // pasted or autofilled code dropped into any box fills the rest.
    const next = (value.slice(0, index) + typed + value.slice(index + typed.length)).slice(
      0,
      LENGTH,
    );
    commit(next);
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      // An empty box deletes the digit before it, as a single field would.
      const target = value[index] === undefined ? index - 1 : index;
      if (target < 0) return;
      onChange(value.slice(0, target) + value.slice(target + 1));
      focusIndex(target);
      return;
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      focusIndex(index - 1);
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      focusIndex(index + 1);
    }
  };

  return (
    <div className="flex justify-between gap-1.5 sm:gap-2" role="group" aria-label="Tasdiqlash kodi">
      {Array.from({ length: LENGTH }, (_, i) => (
        <input
          key={i}
          ref={(el) => {
            inputsRef.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          // Older iOS needs the pattern as well to open the numeric keypad.
          pattern="[0-9]*"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={`${i + 1}-raqam`}
          maxLength={LENGTH}
          value={value[i] ?? ''}
          disabled={disabled}
          autoFocus={autoFocus === true && i === 0}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onFocus={(e) => e.target.select()}
          className="h-14 min-w-0 flex-1 rounded-xl border border-slate-300 bg-surface px-0 text-center text-xl font-semibold text-slate-900 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:bg-slate-100"
        />
      ))}
    </div>
  );
}
