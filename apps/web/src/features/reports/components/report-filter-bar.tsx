'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CalendarRange } from 'lucide-react';
import { format } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatDate } from '@/lib/dates';
import type { ReportGroupBy } from '../api';
import { presetRange, type RangePreset, type ReportFilterState } from '../hooks';

const PRESETS = ['today', 'week', 'month'] as const;
const GROUP_BY_OPTIONS: ReportGroupBy[] = ['day', 'week', 'month'];

export interface ReportFilterBarProps {
  state: ReportFilterState;
  onChange: (next: ReportFilterState) => void;
}

export function ReportFilterBar({ state, onChange }: ReportFilterBarProps) {
  const t = useTranslations('reports');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>(undefined);

  const applyPreset = (preset: (typeof PRESETS)[number]) => {
    onChange({ ...state, preset, ...presetRange(preset) });
  };

  const applyCustom = (range: DateRange | undefined) => {
    setDraft(range);
    if (range?.from && range.to) {
      onChange({
        ...state,
        preset: 'custom' satisfies RangePreset,
        from: format(range.from, 'yyyy-MM-dd'),
        to: format(range.to, 'yyyy-MM-dd'),
      });
      setOpen(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
        {PRESETS.map((preset) => (
          <Button
            key={preset}
            size="sm"
            variant={state.preset === preset ? 'default' : 'ghost'}
            className="h-7 px-3"
            onClick={() => applyPreset(preset)}
          >
            {t(`filters.${preset}`)}
          </Button>
        ))}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              size="sm"
              variant={state.preset === 'custom' ? 'default' : 'ghost'}
              className="h-7 gap-1.5 px-3"
            >
              <CalendarRange className="h-3.5 w-3.5" />
              {state.preset === 'custom'
                ? `${formatDate(state.from)} – ${formatDate(state.to)}`
                : t('filters.custom')}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-0">
            <Calendar
              mode="range"
              numberOfMonths={2}
              selected={draft}
              onSelect={applyCustom}
              defaultMonth={new Date(`${state.from}T00:00:00`)}
            />
          </PopoverContent>
        </Popover>
      </div>

      <Select
        value={state.groupBy}
        onValueChange={(v) => onChange({ ...state, groupBy: v as ReportGroupBy })}
      >
        <SelectTrigger className="h-9 w-[140px]">
          <SelectValue placeholder={t('filters.groupBy')} />
        </SelectTrigger>
        <SelectContent>
          {GROUP_BY_OPTIONS.map((g) => (
            <SelectItem key={g} value={g}>
              {t(`filters.groupByOptions.${g}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
