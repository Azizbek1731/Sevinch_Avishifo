'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthStore } from '@/stores/auth-store';
import {
  inpatientRoomLabel,
  inpatientRoomsApi,
  type InpatientRoomRow,
} from '@/features/admissions/inpatient-rooms-api';
import { useApiErrorToast, useHasPermission } from '../hooks';
import { InpatientRoomDialog } from './inpatient-room-dialog';

export function InpatientRoomsTab() {
  const t = useTranslations('settings.inpatientRooms');
  const branchId = useAuthStore((s) => s.activeBranchId);
  const canWrite = useHasPermission('admissions.write');
  const errorToast = useApiErrorToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<InpatientRoomRow | null>(null);

  const roomsQuery = useQuery({
    queryKey: ['inpatient-rooms', branchId],
    enabled: Boolean(branchId),
    queryFn: async () => {
      const res = await inpatientRoomsApi.list({ branchId: branchId!, limit: 100 });
      return res.data;
    },
  });

  const deactivate = useMutation({
    mutationFn: (id: string) => inpatientRoomsApi.deactivate(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['inpatient-rooms'] });
      toast.success(t('deactivated'));
    },
    onError: errorToast,
  });

  const byFloor = useMemo(() => {
    const map = new Map<number, InpatientRoomRow[]>();
    for (const room of roomsQuery.data ?? []) {
      const list = map.get(room.floor) ?? [];
      list.push(room);
      map.set(room.floor, list);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [roomsQuery.data]);

  const money = (amount: string) =>
    `${Number(amount).toLocaleString('uz-UZ')} ${t('currency')}`;

  if (!branchId) {
    return <p className="text-sm text-muted-foreground">{t('needBranch')}</p>;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle>{t('title')}</CardTitle>
            <CardDescription>{t('description')}</CardDescription>
          </div>
          {canWrite ? (
            <Button
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              {t('add')}
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-6">
          {roomsQuery.isLoading ? <Skeleton className="h-24 w-full" /> : null}
          {!roomsQuery.isLoading && byFloor.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
          ) : null}
          {byFloor.map(([floor, rooms]) => (
            <div key={floor} className="space-y-2">
              <h3 className="text-sm font-medium">{t('floorHeading', { floor })}</h3>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                      <th className="px-3 py-2">{t('number')}</th>
                      <th className="px-3 py-2">{t('name')}</th>
                      <th className="px-3 py-2">{t('occupancy')}</th>
                      <th className="px-3 py-2">{t('pricePerDay')}</th>
                      <th className="px-3 py-2">{t('status')}</th>
                      {canWrite ? <th className="px-3 py-2" /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {rooms.map((room) => (
                      <tr key={room.id} className="border-b last:border-0">
                        <td className="px-3 py-2 font-medium">{inpatientRoomLabel(room)}</td>
                        <td className="px-3 py-2">{room.name || '—'}</td>
                        <td className="px-3 py-2">{room.occupied}</td>
                        <td className="px-3 py-2 tabular-nums">{money(room.pricePerDay)}</td>
                        <td className="px-3 py-2">
                          {room.isActive ? t('activeYes') : t('activeNo')}
                        </td>
                        {canWrite ? (
                          <td className="px-3 py-2">
                            <div className="flex justify-end gap-1">
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                onClick={() => {
                                  setEditing(room);
                                  setDialogOpen(true);
                                }}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              {room.isActive ? (
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  disabled={deactivate.isPending || room.occupied > 0}
                                  onClick={() => deactivate.mutate(room.id)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              ) : null}
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <InpatientRoomDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        branchId={branchId}
        room={editing}
      />
    </div>
  );
}
