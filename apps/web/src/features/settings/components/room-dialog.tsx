'use client';

import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { RoomType, createRoomSchema, type CreateRoomInput } from '@avishifo/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useEnumLabel } from '@/hooks/use-enum-label';
import { emptyToUndefined, settingsApi, type RoomRow } from '../api';
import { useApiErrorToast } from '../hooks';

export interface RoomDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchId: string;
  /** null → create; otherwise edit this room. */
  room: RoomRow | null;
}

const ROOM_TYPES = Object.values(RoomType);

function toSpecialties(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  return String(value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function RoomDialog({ open, onOpenChange, branchId, room }: RoomDialogProps) {
  const t = useTranslations('settings');
  const enumLabel = useEnumLabel();
  const errorToast = useApiErrorToast();
  const queryClient = useQueryClient();
  const isEdit = room !== null;

  const form = useForm<CreateRoomInput>({
    resolver: zodResolver(createRoomSchema),
    defaultValues: { number: '', type: RoomType.CONSULTATION, specialties: [] },
  });

  useEffect(() => {
    if (!open) return;
    if (room) {
      form.reset({
        number: room.number,
        name: room.name ?? undefined,
        type: room.type as RoomType,
        specialties: room.specialties,
      });
    } else {
      form.reset({ number: '', type: RoomType.CONSULTATION, specialties: [] });
    }
  }, [open, room]);

  const mutation = useMutation({
    mutationFn: (values: CreateRoomInput) =>
      room ? settingsApi.updateRoom(room.id, values) : settingsApi.createRoom(branchId, values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['rooms', branchId] });
      toast.success(isEdit ? t('rooms.updated') : t('rooms.created'));
      onOpenChange(false);
    },
    onError: errorToast,
  });

  const type = form.watch('type');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? t('rooms.editTitle') : t('rooms.createTitle')}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
          noValidate
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="room-number">{t('rooms.number')}</Label>
              <Input id="room-number" autoComplete="off" {...form.register('number')} />
              {form.formState.errors.number ? (
                <p className="text-sm text-destructive">{t('form.required')}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="room-name">{t('rooms.name')}</Label>
              <Input
                id="room-name"
                autoComplete="off"
                {...form.register('name', { setValueAs: emptyToUndefined })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t('rooms.type')}</Label>
            <Select
              value={type}
              onValueChange={(v) => form.setValue('type', v as RoomType, { shouldDirty: true })}
            >
              <SelectTrigger>
                <SelectValue placeholder={t('form.select')} />
              </SelectTrigger>
              <SelectContent>
                {ROOM_TYPES.map((rt) => (
                  <SelectItem key={rt} value={rt}>
                    {enumLabel('roomType', rt)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="room-specialties">{t('rooms.specialties')}</Label>
            <Input
              id="room-specialties"
              autoComplete="off"
              {...form.register('specialties', { setValueAs: toSpecialties })}
            />
            <p className="text-xs text-muted-foreground">{t('rooms.specialtiesHint')}</p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
            >
              {t('form.cancel')}
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {t('form.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
