'use client';

import { useState } from 'react';
import { Star } from 'lucide-react';

interface StarRatingProps {
  value: number;
  onChange?: (value: number) => void;
  size?: 'md' | 'lg';
}

const LABELS: Record<number, string> = {
  1: 'Juda yomon',
  2: 'Yomon',
  3: "O'rtacha",
  4: 'Yaxshi',
  5: "A'lo",
};

export function StarRating({ value, onChange, size = 'lg' }: StarRatingProps) {
  const [hovered, setHovered] = useState(0);
  const active = hovered > 0 ? hovered : value;
  const iconSize = size === 'lg' ? 'h-10 w-10' : 'h-6 w-6';
  const readOnly = onChange === undefined;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex gap-1" role="radiogroup" aria-label="Baho">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            role="radio"
            aria-checked={value === star}
            aria-label={`${star} yulduz`}
            disabled={readOnly}
            onClick={() => onChange?.(star)}
            onMouseEnter={() => setHovered(star)}
            onMouseLeave={() => setHovered(0)}
            className={`flex min-h-11 min-w-11 items-center justify-center transition-transform ${
              readOnly ? '' : 'active:scale-90'
            }`}
          >
            <Star
              className={`${iconSize} ${
                star <= active ? 'fill-amber-400 text-amber-400' : 'fill-slate-100 text-slate-300'
              }`}
            />
          </button>
        ))}
      </div>
      {size === 'lg' && (
        <p className="h-5 text-sm text-slate-500">{active > 0 ? LABELS[active] : 'Bahoni tanlang'}</p>
      )}
    </div>
  );
}
