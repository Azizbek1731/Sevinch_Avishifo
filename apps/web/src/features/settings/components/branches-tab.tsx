'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Building2, DoorOpen, MonitorPlay, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { EmptyState } from '@/components/empty-state';
import { useEnumLabel } from '@/hooks/use-enum-label';
import {
  parseWorkingHours,
  settingsApi,
  type BranchRow,
  type RoomRow,
} from '../api';
import { useApiErrorToast, useHasPermission } from '../hooks';
import { BranchDialog } from './branch-dialog';
import { DisplayTokenDialog } from './display-token-dialog';
import { RoomDialog } from './room-dialog';

function RoomsList({ branch, canWrite }: { branch: BranchRow; canWrite: boolean }) {
  const t = useTranslations('settings');
  const enumLabel = useEnumLabel();
  const errorToast = useApiErrorToast();
  const queryClient = useQueryClient();
  const [roomDialogOpen, setRoomDialogOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<RoomRow | null>(null);
  const [deletingRoom, setDeletingRoom] = useState<RoomRow | null>(null);

  const roomsQuery = useQuery({
    queryKey: ['rooms', branch.id],
    queryFn: () => settingsApi.listRooms(branch.id),
  });
  const rooms = roomsQuery.data?.data ?? [];

  const deleteMutation = useMutation({
    mutationFn: (id: string) => settingsApi.deleteRoom(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['rooms', branch.id] });
      toast.success(t('rooms.deleted'));
      setDeletingRoom(null);
    },
    onError: errorToast,
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <DoorOpen className="h-4 w-4 text-muted-foreground" />
          {t('rooms.title')}
        </p>
        {canWrite ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setEditingRoom(null);
              setRoomDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            {t('rooms.add')}
          </Button>
        ) : null}
      </div>

      {roomsQuery.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : rooms.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('rooms.empty')}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {rooms.map((room) => (
            <li key={room.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className="font-medium">{room.number}</span>
              {room.name ? <span className="text-muted-foreground">{room.name}</span> : null}
              <Badge variant="outline">{enumLabel('roomType', room.type)}</Badge>
              {room.specialties.length > 0 ? (
                <span className="truncate text-xs text-muted-foreground">
                  {room.specialties.join(', ')}
                </span>
              ) : null}
              {canWrite ? (
                <span className="ml-auto flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => {
                      setEditingRoom(room);
                      setRoomDialogOpen(true);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive"
                    onClick={() => setDeletingRoom(room)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <RoomDialog
        open={roomDialogOpen}
        onOpenChange={setRoomDialogOpen}
        branchId={branch.id}
        room={editingRoom}
      />
      <ConfirmDialog
        open={deletingRoom !== null}
        onOpenChange={(o) => {
          if (!o) setDeletingRoom(null);
        }}
        title={t('rooms.deleteTitle')}
        description={t('rooms.deleteDesc', { number: deletingRoom?.number ?? '' })}
        confirmLabel={t('form.delete')}
        cancelLabel={t('form.cancel')}
        destructive
        onConfirm={() => {
          if (deletingRoom) deleteMutation.mutate(deletingRoom.id);
        }}
      />
    </div>
  );
}

function BranchWorkingHours({ branch }: { branch: BranchRow }) {
  const t = useTranslations('settings');
  const rows = parseWorkingHours(branch.workingHours);
  if (rows.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs text-muted-foreground sm:grid-cols-4">
      {rows.map((r) => (
        <span key={r.weekday}>
          {t(`branches.weekdays.w${r.weekday}` as never)}:{' '}
          {r.closed ? t('branches.closed') : `${r.open}–${r.close}`}
        </span>
      ))}
    </div>
  );
}

export function BranchesTab() {
  const t = useTranslations('settings');
  const errorToast = useApiErrorToast();
  const queryClient = useQueryClient();
  const canWrite = useHasPermission('branches.write');
  const canToken = useHasPermission('clinic.settings.write');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingBranch, setEditingBranch] = useState<BranchRow | null>(null);
  const [deletingBranch, setDeletingBranch] = useState<BranchRow | null>(null);
  const [tokenBranch, setTokenBranch] = useState<BranchRow | null>(null);
  const [tokenOpen, setTokenOpen] = useState(false);

  const branchesQuery = useQuery({
    queryKey: ['branches'],
    queryFn: () => settingsApi.listBranches(),
  });
  const branches = branchesQuery.data?.data ?? [];

  const deleteMutation = useMutation({
    mutationFn: (id: string) => settingsApi.deleteBranch(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['branches'] });
      toast.success(t('branches.deleted'));
      setDeletingBranch(null);
    },
    onError: errorToast,
  });

  if (branchesQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {canWrite ? (
          <Button
            onClick={() => {
              setEditingBranch(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            {t('branches.add')}
          </Button>
        ) : null}
      </div>

      {branches.length === 0 ? (
        <EmptyState icon={Building2} title={t('branches.emptyTitle')} description={t('branches.emptyDesc')} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {branches.map((branch) => (
            <Card key={branch.id}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    {branch.name}
                    {!branch.isActive ? (
                      <Badge variant="outline" className="text-muted-foreground">
                        {t('branches.inactive')}
                      </Badge>
                    ) : null}
                  </CardTitle>
                  <div className="flex items-center gap-1">
                    {canToken ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setTokenBranch(branch);
                          setTokenOpen(true);
                        }}
                      >
                        <MonitorPlay className="h-4 w-4" />
                        {t('branches.displayToken')}
                      </Button>
                    ) : null}
                    {canWrite ? (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => {
                            setEditingBranch(branch);
                            setDialogOpen(true);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive"
                          onClick={() => setDeletingBranch(branch)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="space-y-0.5 text-sm text-muted-foreground">
                  {branch.address ? <p>{branch.address}</p> : null}
                  {branch.phone ? <p>{branch.phone}</p> : null}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <BranchWorkingHours branch={branch} />
                <Separator />
                <RoomsList branch={branch} canWrite={canWrite} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <BranchDialog open={dialogOpen} onOpenChange={setDialogOpen} branch={editingBranch} />
      <DisplayTokenDialog open={tokenOpen} onOpenChange={setTokenOpen} branch={tokenBranch} />
      <ConfirmDialog
        open={deletingBranch !== null}
        onOpenChange={(o) => {
          if (!o) setDeletingBranch(null);
        }}
        title={t('branches.deleteTitle')}
        description={t('branches.deleteDesc', { name: deletingBranch?.name ?? '' })}
        confirmLabel={t('form.delete')}
        cancelLabel={t('form.cancel')}
        destructive
        onConfirm={() => {
          if (deletingBranch) deleteMutation.mutate(deletingBranch.id);
        }}
      />
    </div>
  );
}
