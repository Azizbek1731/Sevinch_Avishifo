'use client';

import { useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { admitPatientSchema, type AdmitPatientInput } from '@avishifo/shared';
import { useRouter } from '@/i18n/routing';
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
import { useAuthStore } from '@/stores/auth-store';
import { useApiErrorToast } from '@/features/services/hooks';
import { admissionsApi } from '../api';
import {
  inpatientRoomLabel,
  inpatientRoomsApi,
} from '../inpatient-rooms-api';

/** Opening a hospital stay: pick a catalog room (24h price) and referral notes. */
export function AdmitDialog({
  open,
  onOpenChange,
  patientId,
  patientName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  patientId: string;
  patientName: string;
}) {
  const t = useTranslations('admissions');
  const router = useRouter();
  const queryClient = useQueryClient();
  const errorToast = useApiErrorToast();
  const branchId = useAuthStore((s) => s.activeBranchId);

  const form = useForm<AdmitPatientInput>({
    resolver: zodResolver(admitPatientSchema),
    defaultValues: {
      patientId,
      department: '',
      ward: '',
      bed: '',
      inpatientRoomId: undefined,
      dailyRoomRate: '',
      referredBy: '',
      admissionDiagnosis: '',
    },
  });

  const roomsQuery = useQuery({
    queryKey: ['inpatient-rooms', branchId, 'admit'],
    enabled: open && Boolean(branchId),
    queryFn: async () => {
      const res = await inpatientRoomsApi.list({
        branchId: branchId!,
        activeOnly: true,
        limit: 100,
      });
      return res.data;
    },
  });

  const availableRooms = useMemo(() => roomsQuery.data ?? [], [roomsQuery.data]);

  const selectedRoomId = form.watch('inpatientRoomId');
  const selectedRoom = availableRooms.find((room) => room.id === selectedRoomId);

  useEffect(() => {
    if (open) {
      form.reset({
        patientId,
        department: '',
        ward: '',
        bed: '',
        inpatientRoomId: undefined,
        dailyRoomRate: '',
        referredBy: '',
        admissionDiagnosis: '',
      });
    }
  }, [open, patientId, form]);

  useEffect(() => {
    if (!selectedRoom) return;
    form.setValue('dailyRoomRate', selectedRoom.pricePerDay, { shouldValidate: true });
    form.setValue('ward', inpatientRoomLabel(selectedRoom), { shouldDirty: true });
  }, [selectedRoom, form]);

  const admit = useMutation({
    mutationFn: (v: AdmitPatientInput) => admissionsApi.admit(v),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['admissions'] });
      void queryClient.invalidateQueries({ queryKey: ['patients'] });
      void queryClient.invalidateQueries({ queryKey: ['invoices'] });
      void queryClient.invalidateQueries({ queryKey: ['patient-checkout'] });
      void queryClient.invalidateQueries({ queryKey: ['inpatient-rooms'] });
      onOpenChange(false);
      toast.success(t('admitted', { number: res.data.historyNumber }));
      router.push(`/admissions/${res.data.id}`);
    },
    onError: errorToast,
  });

  const money = (amount: string) =>
    `${Number(amount).toLocaleString('uz-UZ')} ${t('roomBilling.currency')}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('admitTitle', { name: patientName })}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={form.handleSubmit((v) =>
            admit.mutate({
              ...v,
              inpatientRoomId: v.inpatientRoomId || undefined,
              dailyRoomRate: v.dailyRoomRate || undefined,
              ward: v.ward || undefined,
              bed: v.bed || undefined,
              department: v.department || undefined,
            }),
          )}
          className="space-y-4"
          noValidate
        >
          <div className="space-y-1.5">
            <Label htmlFor="ad-dept">{t('fields.department')}</Label>
            <Input id="ad-dept" {...form.register('department')} />
          </div>
          <div className="space-y-1.5">
            <Label>{t('fields.room')}</Label>
            <Select
              value={selectedRoomId ?? ''}
              onValueChange={(value) =>
                form.setValue('inpatientRoomId', value, { shouldValidate: true, shouldDirty: true })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder={t('fields.roomPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {availableRooms.map((room) => (
                  <SelectItem key={room.id} value={room.id}>
                    {inpatientRoomLabel(room)} · {money(room.pricePerDay)}
                    {room.occupied > 0 ? ` · ${room.occupied}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!roomsQuery.isLoading && availableRooms.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('fields.roomEmpty')}</p>
            ) : null}
            {selectedRoom ? (
              <p className="text-xs text-muted-foreground">
                {t('roomBilling.selectedRate', { amount: money(selectedRoom.pricePerDay) })}
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ad-bed">{t('fields.bed')}</Label>
            <Input id="ad-bed" {...form.register('bed')} placeholder={t('fields.bedHint')} />
          </div>
          <p className="text-xs text-muted-foreground">{t('roomBilling.rule')}</p>
          <div className="space-y-1.5">
            <Label htmlFor="ad-ref">{t('fields.referredBy')}</Label>
            <Input id="ad-ref" {...form.register('referredBy')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ad-diag">{t('fields.admissionDiagnosis')}</Label>
            <Input id="ad-diag" {...form.register('admissionDiagnosis')} />
          </div>
          <DialogFooter>
            <Button type="submit" className="w-full" disabled={admit.isPending || !selectedRoomId}>
              {t('admit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
