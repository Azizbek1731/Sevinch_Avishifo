'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { useRouter } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuthStore } from '@/stores/auth-store';
import { useApiErrorToast } from '@/features/services/hooks';
import { clinicalOrdersApi } from '@/features/clinical-orders/api';
import { isUziSpecialty } from '@/features/clinical-orders/doctor-matching';
import { ambulatoryApi } from '../api';

/** Reception picks the doctor; a doctor always opens the card for themself. */
export function OpenCaseDialog({
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
  const t = useTranslations('ambulatory');
  const router = useRouter();
  const queryClient = useQueryClient();
  const errorToast = useApiErrorToast();
  const branchId = useAuthStore((s) => s.activeBranchId);
  const isDoctor = useAuthStore((s) => s.user?.role === 'DOCTOR');
  const [doctorId, setDoctorId] = useState('');
  const [doctorError, setDoctorError] = useState(false);
  const [complaint, setComplaint] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!open) return;
    setDoctorId('');
    setDoctorError(false);
    setComplaint('');
    setDiagnosis('');
    setNote('');
  }, [open, patientId]);

  const doctorsQuery = useQuery({
    queryKey: ['clinical-orders', 'doctors', branchId],
    enabled: open && !isDoctor && Boolean(branchId),
    queryFn: async () => (await clinicalOrdersApi.doctors()).data,
  });
  const doctors = useMemo(
    () => (doctorsQuery.data ?? []).filter((doctor) => !isUziSpecialty(doctor.specialty)),
    [doctorsQuery.data],
  );

  const submit = useMutation({
    mutationFn: () =>
      ambulatoryApi.open({
        patientId,
        doctorUserId: isDoctor ? undefined : doctorId,
        complaint: complaint.trim() || undefined,
        diagnosis: diagnosis.trim() || undefined,
        note: note.trim() || undefined,
      }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['ambulatory'] });
      onOpenChange(false);
      toast.success(t('openDialog.opened', { number: res.data.number }));
      router.push(`/ambulatory/${res.data.id}`);
    },
    onError: errorToast,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('openDialog.title', { name: patientName })}</DialogTitle>
          <DialogDescription>{t('openDialog.hint')}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (!isDoctor && !doctorId) {
              setDoctorError(true);
              return;
            }
            submit.mutate();
          }}
        >
          {!isDoctor ? (
            <div className="space-y-1.5">
              <Label>
                {t('fields.doctor')}
                <span className="ml-0.5 text-destructive">*</span>
              </Label>
              <Select
                value={doctorId || undefined}
                onValueChange={(value) => {
                  setDoctorId(value);
                  setDoctorError(false);
                }}
              >
                <SelectTrigger aria-invalid={doctorError}>
                  <SelectValue placeholder={t('fields.doctorPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {doctors.map((doctor) => (
                    <SelectItem key={doctor.id} value={doctor.id}>
                      {doctor.fullName}
                      {doctor.specialty ? ` · ${doctor.specialty}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t('fields.doctorHelp')}</p>
              {doctorError ? (
                <p className="text-xs text-destructive">{t('fields.doctorRequired')}</p>
              ) : null}
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="amb-complaint">{t('fields.complaint')}</Label>
            <Input
              id="amb-complaint"
              value={complaint}
              maxLength={500}
              onChange={(event) => setComplaint(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="amb-diagnosis">{t('fields.diagnosis')}</Label>
            <Input
              id="amb-diagnosis"
              value={diagnosis}
              maxLength={500}
              onChange={(event) => setDiagnosis(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="amb-note">{t('fields.note')}</Label>
            <Textarea
              id="amb-note"
              rows={2}
              value={note}
              maxLength={1000}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="submit" className="w-full" disabled={submit.isPending}>
              {submit.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t('open')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
