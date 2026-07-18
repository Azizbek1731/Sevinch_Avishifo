'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { CalendarOff, Plus, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useEnumLabel } from '@/hooks/use-enum-label';
import { formatDate } from '@/lib/dates';
import { useAuthStore } from '@/stores/auth-store';
import { staffApi, type ScheduleExceptionRow } from '../api';
import { useApiErrorToast, useDoctorSchedule, usePermissions } from '../hooks';
import { ExceptionDialog } from './exception-dialog';

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

interface EditWindow {
  startTime: string;
  endTime: string;
  slotMinutes: number;
}

function emptyWeek(): Record<number, EditWindow[]> {
  const next: Record<number, EditWindow[]> = {};
  for (const d of WEEKDAYS) next[d] = [];
  return next;
}

export function ScheduleTab({ userId }: { userId: string }) {
  const t = useTranslations('staff');
  const enumLabel = useEnumLabel();
  const can = usePermissions();
  const errorToast = useApiErrorToast();
  const queryClient = useQueryClient();
  const canWrite = can('schedules.write');

  const branches = useAuthStore((s) => s.branches);
  const activeBranchId = useAuthStore((s) => s.activeBranchId);
  const [branchId, setBranchId] = useState<string | undefined>(
    activeBranchId ?? branches[0]?.id,
  );

  const query = useDoctorSchedule(userId, branchId);

  const [windows, setWindows] = useState<Record<number, EditWindow[]>>(emptyWeek);
  const [exceptionOpen, setExceptionOpen] = useState(false);
  const [deletingException, setDeletingException] = useState<ScheduleExceptionRow | null>(null);

  useEffect(() => {
    if (!query.data) return;
    const next = emptyWeek();
    for (const row of query.data.data.schedule) {
      const list = next[row.weekday] ?? [];
      list.push({
        startTime: row.startTime,
        endTime: row.endTime,
        slotMinutes: row.slotMinutes,
      });
      next[row.weekday] = list;
    }
    setWindows(next);
  }, [query.data]);

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!branchId) throw new Error('No branch selected');
      const items = WEEKDAYS.flatMap((weekday) =>
        (windows[weekday] ?? []).map((w) => ({ weekday, ...w })),
      );
      return staffApi.setSchedule(userId, { branchId, items });
    },
    onSuccess: () => {
      toast.success(t('schedule.saved'));
      void queryClient.invalidateQueries({ queryKey: ['staff', 'schedule', userId] });
    },
    onError: errorToast,
  });

  const deleteExceptionMutation = useMutation({
    mutationFn: (id: string) => staffApi.deleteException(id),
    onSuccess: () => {
      toast.success(t('schedule.exceptions.deleted'));
      void queryClient.invalidateQueries({ queryKey: ['staff', 'schedule', userId] });
      setDeletingException(null);
    },
    onError: errorToast,
  });

  const updateWindow = (weekday: number, index: number, patch: Partial<EditWindow>) => {
    setWindows((prev) => ({
      ...prev,
      [weekday]: (prev[weekday] ?? []).map((w, i) => (i === index ? { ...w, ...patch } : w)),
    }));
  };

  const addWindow = (weekday: number) => {
    setWindows((prev) => ({
      ...prev,
      [weekday]: [
        ...(prev[weekday] ?? []),
        { startTime: '09:00', endTime: '13:00', slotMinutes: 15 },
      ],
    }));
  };

  const removeWindow = (weekday: number, index: number) => {
    setWindows((prev) => ({
      ...prev,
      [weekday]: (prev[weekday] ?? []).filter((_, i) => i !== index),
    }));
  };

  const exceptions = query.data?.data.exceptions ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-base">{t('schedule.title')}</CardTitle>
          <div className="flex items-center gap-2">
            {branches.length > 1 ? (
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder={t('schedule.branch')} />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            {canWrite ? (
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || !branchId || query.isLoading}
              >
                {t('schedule.save')}
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          {query.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 7 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {WEEKDAYS.map((weekday) => {
                const dayWindows = windows[weekday] ?? [];
                return (
                  <div
                    key={weekday}
                    className="flex flex-col gap-2 border-b pb-3 last:border-b-0 last:pb-0 sm:flex-row sm:items-start"
                  >
                    <div className="w-28 shrink-0 pt-2 text-sm font-medium">
                      {t(`schedule.weekdays.${weekday}` as never)}
                    </div>
                    <div className="flex-1 space-y-2">
                      {dayWindows.length === 0 ? (
                        <p className="pt-2 text-sm text-muted-foreground">
                          {t('schedule.dayOff')}
                        </p>
                      ) : (
                        dayWindows.map((w, index) => (
                          <div key={index} className="flex flex-wrap items-center gap-2">
                            <Input
                              type="time"
                              value={w.startTime}
                              disabled={!canWrite}
                              onChange={(e) =>
                                updateWindow(weekday, index, { startTime: e.target.value })
                              }
                              className="w-28"
                              aria-label={t('schedule.start')}
                            />
                            <span className="text-muted-foreground">—</span>
                            <Input
                              type="time"
                              value={w.endTime}
                              disabled={!canWrite}
                              onChange={(e) =>
                                updateWindow(weekday, index, { endTime: e.target.value })
                              }
                              className="w-28"
                              aria-label={t('schedule.end')}
                            />
                            <div className="flex items-center gap-1">
                              <Input
                                type="number"
                                min={5}
                                max={120}
                                step={5}
                                value={w.slotMinutes}
                                disabled={!canWrite}
                                onChange={(e) => {
                                  const n = Number(e.target.value);
                                  updateWindow(weekday, index, {
                                    slotMinutes: Number.isFinite(n) && n > 0 ? n : 15,
                                  });
                                }}
                                className="w-20"
                                aria-label={t('schedule.slot')}
                              />
                              <span className="text-xs text-muted-foreground">
                                {t('schedule.minutesShort')}
                              </span>
                            </div>
                            {canWrite ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                aria-label={t('schedule.removeWindow')}
                                onClick={() => removeWindow(weekday, index)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            ) : null}
                          </div>
                        ))
                      )}
                      {canWrite ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => addWindow(weekday)}
                          className="h-8"
                        >
                          <Plus className="mr-1 h-3.5 w-3.5" />
                          {t('schedule.addWindow')}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">{t('schedule.exceptions.title')}</CardTitle>
          {canWrite ? (
            <Button variant="outline" size="sm" onClick={() => setExceptionOpen(true)}>
              <Plus className="mr-1 h-4 w-4" />
              {t('schedule.exceptions.add')}
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {query.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : exceptions.length === 0 ? (
            <EmptyState icon={CalendarOff} title={t('schedule.exceptions.empty')} />
          ) : (
            <div className="space-y-2">
              {exceptions.map((ex) => (
                <div
                  key={ex.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
                >
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge variant="secondary">
                      {enumLabel('exception', ex.type)}
                    </Badge>
                    <span className="whitespace-nowrap">
                      {formatDate(ex.dateFrom)}
                      {ex.dateTo !== ex.dateFrom ? ` — ${formatDate(ex.dateTo)}` : null}
                    </span>
                    {ex.startTime && ex.endTime ? (
                      <span className="whitespace-nowrap text-muted-foreground">
                        {ex.startTime}–{ex.endTime}
                      </span>
                    ) : null}
                    {ex.note ? <span className="text-muted-foreground">· {ex.note}</span> : null}
                  </div>
                  {canWrite ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      aria-label={t('actions.delete')}
                      onClick={() => setDeletingException(ex)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ExceptionDialog userId={userId} open={exceptionOpen} onOpenChange={setExceptionOpen} />

      <ConfirmDialog
        open={deletingException !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingException(null);
        }}
        title={t('schedule.exceptions.deleteTitle')}
        description={t('schedule.exceptions.deleteDescription')}
        confirmLabel={t('actions.delete')}
        cancelLabel={t('actions.cancel')}
        destructive
        onConfirm={() => {
          if (deletingException) deleteExceptionMutation.mutate(deletingException.id);
        }}
      />
    </div>
  );
}
