'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { UpdateAdmissionInput } from '@avishifo/shared';
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
import { admissionsApi, type AdmissionDetail } from '../api';

const OTHER_DOCTOR = '__other__';

/** Correct mistyped admission fields (history №, room, doctor, …). */
export function EditAdmissionDialog({
  open,
  onOpenChange,
  admission,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  admission: AdmissionDetail;
}) {
  const t = useTranslations('admissions');
  const tc = useTranslations('common');
  const queryClient = useQueryClient();
  const errorToast = useApiErrorToast();
  const branchId = useAuthStore((s) => s.activeBranchId);

  const [historyNumber, setHistoryNumber] = useState('');
  const [department, setDepartment] = useState('');
  const [ward, setWard] = useState('');
  const [bed, setBed] = useState('');
  const [referredBy, setReferredBy] = useState('');
  const [admissionDiagnosis, setAdmissionDiagnosis] = useState('');
  const [doctorChoice, setDoctorChoice] = useState('');
  const [otherDoctorName, setOtherDoctorName] = useState('');

  const doctorsQuery = useQuery({
    queryKey: ['clinical-orders', 'doctors', branchId],
    enabled: open && Boolean(branchId),
    queryFn: async () => (await clinicalOrdersApi.doctors()).data,
  });

  useEffect(() => {
    if (!open) return;
    setHistoryNumber(admission.historyNumber ?? '');
    setDepartment(admission.department ?? '');
    setWard(admission.ward ?? '');
    setBed(admission.bed ?? '');
    setReferredBy(admission.referredBy ?? '');
    setAdmissionDiagnosis(admission.admissionDiagnosis ?? '');
    if (admission.attendingDoctorUserId) {
      setDoctorChoice(admission.attendingDoctorUserId);
      setOtherDoctorName('');
    } else if (admission.attendingDoctorName || admission.attendingDoctor?.fullName) {
      setDoctorChoice(OTHER_DOCTOR);
      setOtherDoctorName(
        admission.attendingDoctorName ?? admission.attendingDoctor?.fullName ?? '',
      );
    } else {
      setDoctorChoice('');
      setOtherDoctorName('');
    }
  }, [open, admission]);

  const save = useMutation({
    mutationFn: () => {
      const trimmedHistory = historyNumber.trim();
      if (!trimmedHistory) throw new Error('history');
      const fromList = doctorChoice && doctorChoice !== OTHER_DOCTOR;
      const freeName = otherDoctorName.trim();
      if (doctorChoice === OTHER_DOCTOR && !freeName) throw new Error('doctor');

      const body: UpdateAdmissionInput = {
        historyNumber: trimmedHistory,
        department: department.trim() || undefined,
        ward: ward.trim() || undefined,
        bed: bed.trim() || undefined,
        referredBy: referredBy.trim() || undefined,
        admissionDiagnosis: admissionDiagnosis.trim() || undefined,
      };
      if (fromList) {
        body.attendingDoctorUserId = doctorChoice;
        body.attendingDoctorName = null;
      } else if (doctorChoice === OTHER_DOCTOR) {
        body.attendingDoctorUserId = null;
        body.attendingDoctorName = freeName;
      }
      return admissionsApi.update(admission.id, body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admission', admission.id] });
      void queryClient.invalidateQueries({ queryKey: ['admissions'] });
      toast.success(t('edit.saved'));
      onOpenChange(false);
    },
    onError: (err) => {
      if (err instanceof Error && err.message === 'history') {
        toast.error(t('fields.historyNumberPlaceholder'));
        return;
      }
      if (err instanceof Error && err.message === 'doctor') {
        toast.error(t('fields.doctorOtherPlaceholder'));
        return;
      }
      errorToast(err);
    },
  });

  const doctors = doctorsQuery.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('edit.title')}</DialogTitle>
          <DialogDescription>{t('edit.hint')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-history">{t('fields.historyNumber')}</Label>
            <Input
              id="edit-history"
              value={historyNumber}
              onChange={(e) => setHistoryNumber(e.target.value)}
              placeholder={t('fields.historyNumberPlaceholder')}
              className="font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <Label>{t('fields.attendingDoctor')}</Label>
            <Select value={doctorChoice} onValueChange={setDoctorChoice}>
              <SelectTrigger>
                <SelectValue placeholder={t('fields.attendingDoctorPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {doctors.map((doctor) => (
                  <SelectItem key={doctor.id} value={doctor.id}>
                    {doctor.fullName}
                    {doctor.specialty ? ` · ${doctor.specialty}` : ''}
                  </SelectItem>
                ))}
                <SelectItem value={OTHER_DOCTOR}>{t('fields.doctorOther')}</SelectItem>
              </SelectContent>
            </Select>
            {doctorChoice === OTHER_DOCTOR ? (
              <Input
                className="mt-2"
                placeholder={t('fields.doctorOtherPlaceholder')}
                value={otherDoctorName}
                onChange={(e) => setOtherDoctorName(e.target.value)}
              />
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-ward">{t('fields.roomNumber')}</Label>
              <Input
                id="edit-ward"
                value={ward}
                onChange={(e) => setWard(e.target.value)}
                placeholder={t('fields.roomNumberHint')}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-bed">{t('fields.bed')}</Label>
              <Input
                id="edit-bed"
                value={bed}
                onChange={(e) => setBed(e.target.value)}
                placeholder={t('fields.bedHint')}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-dept">{t('fields.department')}</Label>
            <Input
              id="edit-dept"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-ref">{t('fields.referredBy')}</Label>
            <Input
              id="edit-ref"
              value={referredBy}
              onChange={(e) => setReferredBy(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-diag">{t('fields.admissionDiagnosis')}</Label>
            <Input
              id="edit-diag"
              value={admissionDiagnosis}
              onChange={(e) => setAdmissionDiagnosis(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            disabled={save.isPending}
            onClick={() => onOpenChange(false)}
          >
            {tc('cancel')}
          </Button>
          <Button
            type="button"
            disabled={save.isPending || !historyNumber.trim()}
            onClick={() => save.mutate()}
          >
            {t('edit.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
