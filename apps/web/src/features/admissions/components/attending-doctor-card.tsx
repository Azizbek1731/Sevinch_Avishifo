'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

/** Assign attending doctor on stays opened before the field existed (or left empty). */
export function AttendingDoctorCard({
  admission,
  canEdit,
}: {
  admission: AdmissionDetail;
  canEdit: boolean;
}) {
  const t = useTranslations('admissions');
  const queryClient = useQueryClient();
  const errorToast = useApiErrorToast();
  const branchId = useAuthStore((s) => s.activeBranchId);
  const currentName = admission.attendingDoctor?.fullName ?? admission.attendingDoctorName ?? null;
  const [doctorChoice, setDoctorChoice] = useState('');
  const [otherName, setOtherName] = useState('');
  const [editing, setEditing] = useState(!currentName);

  const doctorsQuery = useQuery({
    queryKey: ['clinical-orders', 'doctors', branchId],
    enabled: canEdit && Boolean(branchId) && editing,
    queryFn: async () => (await clinicalOrdersApi.doctors()).data,
  });

  const save = useMutation({
    mutationFn: () => {
      const fromList = doctorChoice && doctorChoice !== OTHER_DOCTOR;
      if (fromList) {
        return admissionsApi.update(admission.id, {
          attendingDoctorUserId: doctorChoice,
          attendingDoctorName: null,
        });
      }
      const name = otherName.trim();
      if (!name) throw new Error('name');
      return admissionsApi.update(admission.id, {
        attendingDoctorUserId: null,
        attendingDoctorName: name,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admission', admission.id] });
      void queryClient.invalidateQueries({ queryKey: ['admissions'] });
      toast.success(t('doctorSaved'));
      setEditing(false);
      setDoctorChoice('');
      setOtherName('');
    },
    onError: (err) => {
      if (err instanceof Error && err.message === 'name') {
        toast.error(t('fields.doctorOtherPlaceholder'));
        return;
      }
      errorToast(err);
    },
  });

  if (!canEdit && !currentName) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <UserRound className="h-4 w-4" />
          {t('doctorMissing')}
        </CardContent>
      </Card>
    );
  }

  if (currentName && !editing) {
    return (
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="flex items-center gap-2 text-sm">
            <UserRound className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">{t('fields.attendingDoctor')}:</span>
            <span className="font-medium">{currentName}</span>
          </div>
          {canEdit ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
              {t('doctorChange')}
            </Button>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  if (!canEdit) return null;

  const doctors = doctorsQuery.data ?? [];
  const canSave =
    (doctorChoice && doctorChoice !== OTHER_DOCTOR) ||
    (doctorChoice === OTHER_DOCTOR && otherName.trim().length > 0);

  return (
    <Card className="border-dashed border-amber-500/40 bg-amber-500/5">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <UserRound className="h-4 w-4" />
          {currentName ? t('doctorChange') : t('doctorAssign')}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{t('doctorAssignHint')}</p>
      </CardHeader>
      <CardContent className="space-y-3">
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
              value={otherName}
              onChange={(e) => setOtherName(e.target.value)}
              autoFocus
            />
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={!canSave || save.isPending}
            onClick={() => save.mutate()}
          >
            {t('doctorSave')}
          </Button>
          {currentName ? (
            <Button
              type="button"
              variant="ghost"
              disabled={save.isPending}
              onClick={() => {
                setEditing(false);
                setDoctorChoice('');
                setOtherName('');
              }}
            >
              {t('back')}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
