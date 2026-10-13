'use client';

import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import {
  Gender,
  formatPhone,
  normalizePhone,
  type CreatePatientInput,
  phoneWireValueOptional,
} from '@avishifo/shared';
import { ApiError } from '@/lib/api-client';
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
import { PhoneInput } from '@/components/ui/phone-input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useEnumLabel } from '@/hooks/use-enum-label';
import { useCreatePatient } from '../hooks';
import type { DuplicateCandidate, PatientHit } from '../api';

interface FastRegValues {
  firstName: string;
  lastName: string;
  phone: string;
  dob: string;
  gender: '' | Gender;
}

export interface NewPatientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the created patient (e.g. to select it in the walk-in flow). */
  onCreated?: (patient: PatientHit) => void;
  onSelectExisting?: (patient: PatientHit) => void;
}

export function NewPatientDialog({
  open,
  onOpenChange,
  onCreated,
  onSelectExisting,
}: NewPatientDialogProps) {
  const t = useTranslations('reception');
  const tc = useTranslations('common');
  const enumLabel = useEnumLabel();
  const createMutation = useCreatePatient();
  const [candidates, setCandidates] = useState<DuplicateCandidate[]>([]);

  const schema = useMemo(
    () =>
      z.object({
        firstName: z.string().trim().min(1, tc('required')),
        lastName: z.string().trim().min(1, tc('required')),
        phone: z
          .string()
          .min(1, tc('required'))
          .refine((v) => normalizePhone(v) !== null, t('newPatient.invalidPhone')),
        dob: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]),
        gender: z.union([z.nativeEnum(Gender), z.literal('')]),
      }),
    [t, tc],
  );

  const form = useForm<FastRegValues>({
    resolver: zodResolver(schema),
    defaultValues: { firstName: '', lastName: '', phone: '', dob: '', gender: '' },
  });

  const close = (next: boolean) => {
    if (!next) {
      form.reset();
      setCandidates([]);
    }
    onOpenChange(next);
  };

  const submit = (force: boolean) =>
    form.handleSubmit((values) => {
      const body: CreatePatientInput = {
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
        phone: normalizePhone(values.phone) ?? undefined,
        dob: values.dob || undefined,
        gender: values.gender || undefined,
        // The care workflow continues after registration; admission assigns a bed later.
        careType: 'AMBULATORY',
        allergies: [],
        chronicConditions: [],
        tags: [],
      };
      createMutation.mutate(
        { body, force },
        {
          onSuccess: (patient) => {
            close(false);
            onCreated?.(patient);
          },
          onError: (err: unknown) => {
            if (err instanceof ApiError && err.code === 'DUPLICATE_PATIENT') {
              setCandidates((err.details ?? []) as DuplicateCandidate[]);
            }
          },
        },
      );
    })();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!createMutation.isPending) close(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('newPatient.title')}</DialogTitle>
          <DialogDescription>{t('newPatient.subtitle')}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            // Portal events still bubble through the outer appointment/invoice form.
            e.stopPropagation();
            if (createMutation.isPending) return;
            void submit(false);
          }}
          noValidate
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="np-lastName">{t('newPatient.lastName')}</Label>
              <Input id="np-lastName" autoFocus {...form.register('lastName')} />
              <FieldError message={form.formState.errors.lastName?.message} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="np-firstName">{t('newPatient.firstName')}</Label>
              <Input id="np-firstName" {...form.register('firstName')} />
              <FieldError message={form.formState.errors.firstName?.message} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="np-phone">{tc('phone')}</Label>
            <PhoneInput
              id="np-phone"
              {...form.register('phone', { setValueAs: phoneWireValueOptional })}
            />
            <FieldError message={form.formState.errors.phone?.message} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="np-dob">{t('newPatient.dob')}</Label>
              <Input id="np-dob" type="date" {...form.register('dob')} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('newPatient.gender')}</Label>
              <Select
                value={form.watch('gender')}
                onValueChange={(v) => form.setValue('gender', v as Gender)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={tc('select')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={Gender.MALE}>{enumLabel('gender', Gender.MALE)}</SelectItem>
                  <SelectItem value={Gender.FEMALE}>
                    {enumLabel('gender', Gender.FEMALE)}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {candidates.length > 0 ? (
            <div className="space-y-2 rounded-md border border-warning/50 bg-warning/10 p-3">
              <p className="text-sm font-medium">{t('newPatient.duplicatesFound')}</p>
              <ul className="space-y-1">
                {candidates.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate">{c.fullName}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {c.phone ? formatPhone(c.phone) : c.mrn}
                    </span>
                    {onSelectExisting ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={createMutation.isPending}
                        onClick={() => {
                          close(false);
                          onSelectExisting(c);
                        }}
                      >
                        {t('newPatient.selectExisting')}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <DialogFooter className="gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              disabled={createMutation.isPending}
              onClick={() => close(false)}
            >
              {tc('cancel')}
            </Button>
            {candidates.length > 0 ? (
              <Button
                type="button"
                variant="destructive"
                disabled={createMutation.isPending}
                onClick={() => void submit(true)}
              >
                {t('newPatient.forceCreate')}
              </Button>
            ) : (
              <Button type="submit" disabled={createMutation.isPending}>
                {tc('create')}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs font-medium text-destructive">{message}</p>;
}
