'use client';

import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  createInpatientRoomSchema,
  type CreateInpatientRoomInput,
} from '@avishifo/shared';
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
import { Switch } from '@/components/ui/switch';
import {
  inpatientRoomsApi,
  type InpatientRoomRow,
} from '@/features/admissions/inpatient-rooms-api';
import { useApiErrorToast } from '../hooks';

type FormValues = {
  floor: number;
  number: string;
  name?: string;
  pricePerDay: string;
  isActive?: boolean;
};

export function InpatientRoomDialog({
  open,
  onOpenChange,
  branchId,
  room,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchId: string;
  room: InpatientRoomRow | null;
}) {
  const t = useTranslations('settings.inpatientRooms');
  const errorToast = useApiErrorToast();
  const queryClient = useQueryClient();
  const form = useForm<FormValues>({
    resolver: zodResolver(createInpatientRoomSchema.omit({ branchId: true })),
    defaultValues: {
      floor: 2,
      number: '',
      name: '',
      pricePerDay: '',
      isActive: true,
    },
  });

  useEffect(() => {
    if (!open) return;
    if (room) {
      form.reset({
        floor: room.floor,
        number: room.number,
        name: room.name ?? '',
        pricePerDay: room.pricePerDay,
        isActive: room.isActive,
      });
    } else {
      form.reset({ floor: 2, number: '', name: '', pricePerDay: '', isActive: true });
    }
  }, [open, room, form]);

  const save = useMutation({
    mutationFn: async (values: FormValues) => {
      if (room) {
        return inpatientRoomsApi.update(room.id, {
          floor: values.floor,
          number: values.number,
          name: values.name?.trim() ? values.name.trim() : null,
          pricePerDay: values.pricePerDay,
          isActive: values.isActive,
        });
      }
      const body: CreateInpatientRoomInput = {
        branchId,
        floor: values.floor,
        number: values.number,
        name: values.name?.trim() || undefined,
        pricePerDay: values.pricePerDay,
      };
      return inpatientRoomsApi.create(body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['inpatient-rooms'] });
      toast.success(room ? t('updated') : t('created'));
      onOpenChange(false);
    },
    onError: errorToast,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{room ? t('editTitle') : t('createTitle')}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          noValidate
          onSubmit={form.handleSubmit((values) => save.mutate(values))}
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ir-floor">{t('floor')}</Label>
              <Input
                id="ir-floor"
                type="number"
                min={1}
                max={20}
                {...form.register('floor', { valueAsNumber: true })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ir-number">{t('number')}</Label>
              <Input id="ir-number" {...form.register('number')} placeholder="201" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ir-name">{t('name')}</Label>
            <Input id="ir-name" {...form.register('name')} placeholder={t('namePlaceholder')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ir-price">{t('pricePerDay')}</Label>
            <Input
              id="ir-price"
              inputMode="decimal"
              placeholder="150000"
              {...form.register('pricePerDay')}
            />
          </div>
          <p className="text-xs text-muted-foreground">{t('priceHint')}</p>
          {room ? (
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <Label htmlFor="ir-active">{t('active')}</Label>
              <Switch
                id="ir-active"
                checked={form.watch('isActive') !== false}
                onCheckedChange={(checked) => form.setValue('isActive', checked, { shouldDirty: true })}
              />
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {t('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
