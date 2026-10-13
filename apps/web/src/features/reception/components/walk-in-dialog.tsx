'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { UserPlus, X } from 'lucide-react';
import { TicketPriority, formatPhone } from '@avishifo/shared';
import { useAuthStore } from '@/stores/auth-store';
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
import { useEnumLabel } from '@/hooks/use-enum-label';
import { useCreateWalkIn, useDoctors, usePatientSearch } from '../hooks';
import type { PatientHit } from '../api';
import { NewPatientDialog } from './new-patient-dialog';

/** Walk-in appointments start "now" rounded UP to the next 5-minute mark. */
function roundedNowIso(): string {
  const step = 5 * 60_000;
  return new Date(Math.ceil(Date.now() / step) * step).toISOString();
}

function useDebounced(value: string, delayMs = 300): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

export interface WalkInDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WalkInDialog({ open, onOpenChange }: WalkInDialogProps) {
  const t = useTranslations('reception');
  const tc = useTranslations('common');
  const enumLabel = useEnumLabel();
  const branchId = useAuthStore((s) => s.activeBranchId);
  const canCreatePatient = useAuthStore((s) =>
    Boolean(s.user?.permissions.includes('patients.write')),
  );

  const [patient, setPatient] = useState<PatientHit | null>(null);
  const [search, setSearch] = useState('');
  const [doctorUserId, setDoctorUserId] = useState('');
  const [priority, setPriority] = useState<TicketPriority>(TicketPriority.NORMAL);
  const [newPatientOpen, setNewPatientOpen] = useState(false);

  const debouncedSearch = useDebounced(search);
  const { data: hits, isFetching: searching } = usePatientSearch(patient ? '' : debouncedSearch);
  const { data: doctors, isLoading: doctorsLoading } = useDoctors();
  const walkInMutation = useCreateWalkIn();

  const close = (next: boolean) => {
    if (!next) {
      setPatient(null);
      setSearch('');
      setDoctorUserId('');
      setPriority(TicketPriority.NORMAL);
    }
    onOpenChange(next);
  };

  const submit = () => {
    if (!patient || !doctorUserId || !branchId) return;
    walkInMutation.mutate(
      {
        input: {
          patientId: patient.id,
          branchId,
          doctorUserId,
          startAt: roundedNowIso(),
          walkIn: true,
        },
        priority,
      },
      { onSuccess: () => close(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('walkIn.title')}</DialogTitle>
          <DialogDescription>{t('walkIn.subtitle')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="wi-patient">{tc('patient')}</Label>
            {patient ? (
              <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/50 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{patient.fullName}</p>
                  <p className="text-xs text-muted-foreground">
                    {patient.phone ? formatPhone(patient.phone) : patient.mrn}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={tc('delete')}
                  onClick={() => setPatient(null)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <>
                <Input
                  id="wi-patient"
                  placeholder={t('walkIn.searchPlaceholder')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  autoComplete="off"
                />
                {debouncedSearch.trim().length >= 2 ? (
                  <div className="max-h-44 overflow-y-auto rounded-md border">
                    {(hits ?? []).map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                        onClick={() => {
                          setPatient(p);
                          setSearch('');
                        }}
                      >
                        <span className="truncate font-medium">{p.fullName}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {p.phone ? formatPhone(p.phone) : p.mrn}
                        </span>
                      </button>
                    ))}
                    {!searching && (hits ?? []).length === 0 ? (
                      <p className="px-3 py-2 text-sm text-muted-foreground">{tc('notFound')}</p>
                    ) : null}
                  </div>
                ) : null}
                {canCreatePatient ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => setNewPatientOpen(true)}
                  >
                    <UserPlus className="mr-2 h-4 w-4" />
                    {t('walkIn.quickCreate')}
                  </Button>
                ) : null}
              </>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>{tc('doctor')}</Label>
            <Select value={doctorUserId} onValueChange={setDoctorUserId}>
              <SelectTrigger>
                <SelectValue placeholder={doctorsLoading ? tc('loading') : tc('select')} />
              </SelectTrigger>
              <SelectContent>
                {(doctors ?? []).map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.fullName}
                    {d.specialty ? ` — ${d.specialty}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>{t('queue.priority')}</Label>
            <Select value={priority} onValueChange={(v) => setPriority(v as TicketPriority)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(TicketPriority).map((p) => (
                  <SelectItem key={p} value={p}>
                    {enumLabel('priority', p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => close(false)}>
            {tc('cancel')}
          </Button>
          <Button
            type="button"
            disabled={!patient || !doctorUserId || walkInMutation.isPending}
            onClick={submit}
          >
            {t('walkIn.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>

      <NewPatientDialog
        open={newPatientOpen}
        onOpenChange={setNewPatientOpen}
        onCreated={(p) => setPatient(p)}
        onSelectExisting={(p) => setPatient(p)}
      />
    </Dialog>
  );
}
