'use client';

import * as React from 'react';
import type { AppointmentStatus } from '@avishifo/shared';
import { formatTime } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { StatusBadge } from '@/components/status-badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { Appointment } from '../api';

export const GRID_START_HOUR = 8;
export const GRID_END_HOUR = 20;
export const SLOT_MINUTES = 30;
const ROW_PX = 44;
const START_MIN = GRID_START_HOUR * 60;
const END_MIN = GRID_END_HOUR * 60;
const ROW_COUNT = ((GRID_END_HOUR - GRID_START_HOUR) * 60) / SLOT_MINUTES;
const BODY_PX = ROW_COUNT * ROW_PX;

export interface CalendarColumn {
  key: string;
  label: string;
  sublabel?: string;
  /** Calendar date (Tashkent) "YYYY-MM-DD" — used for empty-slot clicks. */
  date: string;
  doctorUserId: string;
  isToday?: boolean;
  appointments: Appointment[];
}

interface CalendarGridProps {
  columns: CalendarColumn[];
  statusLabel: (status: AppointmentStatus) => string;
  /** Click on an empty slot → prefill the create dialog. Omit to disable. */
  onSlotClick?: (column: CalendarColumn, time: string) => void;
  onAppointmentClick: (appointment: Appointment) => void;
}

const STATUS_BLOCK: Record<AppointmentStatus, string> = {
  SCHEDULED: 'border-l-primary bg-primary/10 hover:bg-primary/20',
  CONFIRMED: 'border-l-success bg-success/15 hover:bg-success/25',
  CHECKED_IN: 'border-l-primary bg-primary/20 hover:bg-primary/30',
  IN_QUEUE: 'border-l-warning bg-warning/20 hover:bg-warning/30',
  IN_PROGRESS: 'border-l-primary bg-primary/25 hover:bg-primary/35',
  COMPLETED: 'border-l-success bg-success/10 opacity-70 hover:opacity-100',
  NO_SHOW: 'border-l-destructive bg-destructive/10 opacity-70 hover:opacity-100',
  CANCELLED: 'border-l-destructive bg-destructive/10 opacity-60 hover:opacity-90',
};

/** Minutes since Tashkent midnight for a UTC ISO instant. */
function minutesOfDay(iso: string): number {
  const [h, m] = formatTime(iso).split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function slotTime(index: number): string {
  const minutes = START_MIN + index * SLOT_MINUTES;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

interface BlockLayout {
  appointment: Appointment;
  top: number;
  height: number;
  leftPct: number;
  widthPct: number;
}

/** Position blocks; overlapping appointments share the column width via lanes. */
function layoutColumn(appointments: Appointment[]): BlockLayout[] {
  const items = appointments
    .map((a) => {
      const rawStart = minutesOfDay(a.startAt);
      const rawEnd = minutesOfDay(a.endAt);
      const start = Math.max(rawStart, START_MIN);
      const end = Math.min(Math.max(rawEnd > rawStart ? rawEnd : rawStart + 15, start + 15), END_MIN);
      return { a, start, end, visible: rawEnd > START_MIN && rawStart < END_MIN };
    })
    .filter((x) => x.visible && x.end > x.start)
    .sort((x, y) => x.start - y.start || x.end - y.end);

  const out: BlockLayout[] = [];
  let cluster: typeof items = [];
  let clusterEnd = -1;

  const flush = () => {
    if (cluster.length === 0) return;
    const laneEnds: number[] = [];
    const lanes = cluster.map((it) => {
      let lane = laneEnds.findIndex((e) => e <= it.start);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(it.end);
      } else {
        laneEnds[lane] = it.end;
      }
      return lane;
    });
    const laneCount = laneEnds.length;
    cluster.forEach((it, i) => {
      out.push({
        appointment: it.a,
        top: ((it.start - START_MIN) / SLOT_MINUTES) * ROW_PX + 1,
        height: Math.max(((it.end - it.start) / SLOT_MINUTES) * ROW_PX - 2, 18),
        leftPct: ((lanes[i] ?? 0) / laneCount) * 100,
        widthPct: 100 / laneCount,
      });
    });
    cluster = [];
  };

  for (const it of items) {
    if (cluster.length > 0 && it.start >= clusterEnd) {
      flush();
      clusterEnd = -1;
    }
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  flush();
  return out;
}

export function CalendarGrid({
  columns,
  statusLabel,
  onSlotClick,
  onAppointmentClick,
}: CalendarGridProps) {
  const hours = Array.from({ length: GRID_END_HOUR - GRID_START_HOUR }, (_, i) => GRID_START_HOUR + i);
  const nowMin = minutesOfDay(new Date().toISOString());
  const showNowLine = nowMin > START_MIN && nowMin < END_MIN;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <div
          className="grid"
          style={{
            gridTemplateColumns: `56px repeat(${columns.length}, minmax(150px, 1fr))`,
            minWidth: 56 + columns.length * 150,
          }}
        >
          {/* Header row */}
          <div className="sticky left-0 z-30 border-b bg-card" />
          {columns.map((col) => (
            <div
              key={`h-${col.key}`}
              className={cn(
                'border-b border-l px-2 py-2 text-center',
                col.isToday && 'bg-primary/5',
              )}
            >
              <p className="truncate text-sm font-semibold">{col.label}</p>
              {col.sublabel ? (
                <p className={cn('truncate text-xs text-muted-foreground', col.isToday && 'font-medium text-primary')}>
                  {col.sublabel}
                </p>
              ) : null}
            </div>
          ))}

          {/* Time gutter */}
          <div className="sticky left-0 z-30 bg-card" style={{ height: BODY_PX }}>
            <div className="relative h-full border-r">
              {hours.map((h) => (
                <div
                  key={h}
                  className={cn(
                    'absolute right-2 text-xs text-muted-foreground',
                    h !== GRID_START_HOUR && '-translate-y-1/2',
                  )}
                  style={{ top: ((h * 60 - START_MIN) / SLOT_MINUTES) * ROW_PX }}
                >
                  {`${String(h).padStart(2, '0')}:00`}
                </div>
              ))}
            </div>
          </div>

          {/* Day columns */}
          {columns.map((col) => {
            const blocks = layoutColumn(col.appointments);
            return (
              <div
                key={col.key}
                className={cn('relative border-l', col.isToday && 'bg-primary/[0.03]')}
                style={{ height: BODY_PX }}
              >
                {/* Slot cells */}
                {Array.from({ length: ROW_COUNT }, (_, i) => {
                  const time = slotTime(i);
                  const hourEdge = i % 2 === 0;
                  return onSlotClick ? (
                    <button
                      key={time}
                      type="button"
                      aria-label={`${col.label} ${time}`}
                      className={cn(
                        'block w-full cursor-pointer border-b transition-colors hover:bg-accent/60',
                        hourEdge ? 'border-border/60' : 'border-border/30',
                      )}
                      style={{ height: ROW_PX }}
                      onClick={() => onSlotClick(col, time)}
                    />
                  ) : (
                    <div
                      key={time}
                      className={cn('border-b', hourEdge ? 'border-border/60' : 'border-border/30')}
                      style={{ height: ROW_PX }}
                    />
                  );
                })}

                {/* Now line */}
                {col.isToday && showNowLine ? (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-destructive/70"
                    style={{ top: ((nowMin - START_MIN) / SLOT_MINUTES) * ROW_PX }}
                  />
                ) : null}

                {/* Appointment blocks */}
                {blocks.map(({ appointment: a, top, height, leftPct, widthPct }) => (
                  <Tooltip key={a.id}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className={cn(
                          'absolute z-10 overflow-hidden rounded-md border-l-4 px-1.5 py-0.5 text-left shadow-sm transition-colors',
                          STATUS_BLOCK[a.status],
                        )}
                        style={{
                          top,
                          height,
                          left: `calc(${leftPct}% + 2px)`,
                          width: `calc(${widthPct}% - 4px)`,
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onAppointmentClick(a);
                        }}
                      >
                        <p
                          className={cn(
                            'truncate text-xs font-medium text-foreground',
                            a.status === 'CANCELLED' && 'line-through',
                          )}
                        >
                          {a.patient.fullName}
                        </p>
                        {height >= 36 ? (
                          <p className="truncate text-[10px] text-muted-foreground">
                            {formatTime(a.startAt)}–{formatTime(a.endAt)}
                          </p>
                        ) : null}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="space-y-1">
                      <p className="font-semibold">{a.patient.fullName}</p>
                      <p className="text-xs">
                        {formatTime(a.startAt)}–{formatTime(a.endAt)} · {a.doctor.fullName}
                      </p>
                      <StatusBadge status={a.status} label={statusLabel(a.status)} />
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </TooltipProvider>
  );
}
