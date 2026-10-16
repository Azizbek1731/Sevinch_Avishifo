'use client';

import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
import { useApiErrorToast } from '@/features/services/hooks';
import { admissionsApi } from '../api';

/** Opening a hospital stay: the ward details, and what the referral said. */
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

  const form = useForm<AdmitPatientInput>({
    resolver: zodResolver(admitPatientSchema),
    defaultValues: { patientId, department: '', ward: '', bed: '', dailyRoomRate: '', referredBy: '', admissionDiagnosis: '' },
  });

  useEffect(() => {
    if (open) form.reset({ patientId, department: '', ward: '', bed: '', dailyRoomRate: '', referredBy: '', admissionDiagnosis: '' });
  }, [open, patientId, form]);

  const admit = useMutation({
    mutationFn: (v: AdmitPatientInput) => admissionsApi.admit(v),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['admissions'] });
      void queryClient.invalidateQueries({ queryKey: ['patients'] });
      void queryClient.invalidateQueries({ queryKey: ['invoices'] });
      void queryClient.invalidateQueries({ queryKey: ['patient-checkout'] });
      onOpenChange(false);
      toast.success(t('admitted', { number: res.data.historyNumber }));
      router.push(`/admissions/${res.data.id}`);
    },
    onError: errorToast,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('admitTitle', { name: patientName })}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((v) => admit.mutate(v))} className="space-y-4" noValidate>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-3 space-y-1.5">
              <Label htmlFor="ad-dept">{t('fields.department')}</Label>
              <Input id="ad-dept" {...form.register('department')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ad-ward">{t('fields.ward')}</Label>
              <Input id="ad-ward" {...form.register('ward')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ad-bed">{t('fields.bed')}</Label>
              <Input id="ad-bed" {...form.register('bed')} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ad-room-rate">{t('roomBilling.dailyRate')}</Label>
            <Input id="ad-room-rate" inputMode="decimal" placeholder="100000" disabled={admit.isPending} {...form.register('dailyRoomRate')} />
            <p className="text-xs text-muted-foreground">{t('roomBilling.rule')}</p>
            <p className="text-xs text-muted-foreground">{t('roomBilling.zeroHint')}</p>
            {form.formState.errors.dailyRoomRate ? <p className="text-xs text-destructive">{t('roomBilling.invalidRate')}</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ad-ref">{t('fields.referredBy')}</Label>
            <Input id="ad-ref" {...form.register('referredBy')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ad-diag">{t('fields.admissionDiagnosis')}</Label>
            <Input id="ad-diag" {...form.register('admissionDiagnosis')} />
          </div>
          <DialogFooter>
            <Button type="submit" className="w-full" disabled={admit.isPending}>
              {t('admit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
