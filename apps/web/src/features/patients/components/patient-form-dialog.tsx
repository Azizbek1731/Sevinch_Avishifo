'use client';

import { useEffect, useMemo, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { X } from 'lucide-react';
import {
  BloodGroup,
  Gender,
  PATIENT_SOURCES,
  PATIENT_TAGS,
  allergySchema,
  createPatientSchema,
  formatPhone,
  normalizePhone,
  type CreatePatientInput,
} from '@avishifo/shared';
import { ApiError } from '@/lib/api-client';
import { useRouter } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
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
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { patientsApi, type DuplicateCandidate, type Patient, type PatientAllergy } from '../api';
import { useApiErrorToast } from '../hooks';

// ------------------------------------------------------------ phone mask

/** Progressive input mask: digits → "+998 90 123-45-67". */
export function maskPhone(raw: string): string {
  let d = raw.replace(/\D/g, '');
  if (d.length > 9 && d.startsWith('998')) d = d.slice(3);
  d = d.slice(0, 9);
  if (d.length === 0) return '';
  let out = `+998 ${d.slice(0, 2)}`;
  if (d.length > 2) out += ` ${d.slice(2, 5)}`;
  if (d.length > 5) out += `-${d.slice(5, 7)}`;
  if (d.length > 7) out += `-${d.slice(7, 9)}`;
  return out;
}

// ------------------------------------------------------------ form schema

const UNSET = '__unset__';

function buildFormSchema(msg: { required: string; invalidPhone: string }) {
  const optionalPhone = z
    .string()
    .refine((v) => v.trim() === '' || normalizePhone(v) !== null, { message: msg.invalidPhone });
  return z.object({
    lastName: z.string().min(1, msg.required),
    firstName: z.string().min(1, msg.required),
    middleName: z.string(),
    phone: optionalPhone,
    phoneAlt: optionalPhone,
    dob: z.string(),
    gender: z.string(),
    bloodGroup: z.string(),
    address: z.string(),
    passportId: z.string(),
    notes: z.string(),
    source: z.string(),
    allergies: z.array(allergySchema),
    chronicConditions: z.array(z.string().min(1)),
    tags: z.array(z.string().min(1)),
  });
}

type PatientFormValues = z.infer<ReturnType<typeof buildFormSchema>>;

function emptyValues(): PatientFormValues {
  return {
    lastName: '',
    firstName: '',
    middleName: '',
    phone: '',
    phoneAlt: '',
    dob: '',
    gender: UNSET,
    bloodGroup: UNSET,
    address: '',
    passportId: '',
    notes: '',
    source: UNSET,
    allergies: [],
    chronicConditions: [],
    tags: [],
  };
}

function valuesFromPatient(p: Patient): PatientFormValues {
  return {
    lastName: p.lastName,
    firstName: p.firstName,
    middleName: p.middleName ?? '',
    phone: p.phone ? formatPhone(p.phone) : '',
    phoneAlt: p.phoneAlt ? formatPhone(p.phoneAlt) : '',
    dob: p.dob ?? '',
    gender: p.gender ?? UNSET,
    bloodGroup: p.bloodGroup === 'UNKNOWN' ? UNSET : p.bloodGroup,
    address: p.address ?? '',
    passportId: p.passportId ?? '',
    notes: p.notes ?? '',
    source: p.source ?? UNSET,
    allergies: Array.isArray(p.allergies) ? p.allergies : [],
    chronicConditions: Array.isArray(p.chronicConditions) ? p.chronicConditions : [],
    tags: p.tags,
  };
}

const opt = (v: string): string | undefined => (v.trim() === '' ? undefined : v.trim());
const optPhone = (v: string): string | undefined =>
  v.trim() === '' ? undefined : (normalizePhone(v) ?? undefined);
const optEnum = (v: string): string | undefined => (v === UNSET || v === '' ? undefined : v);

/** Final payload is re-validated against the shared schema (source of truth). */
function toPayload(v: PatientFormValues): CreatePatientInput {
  return createPatientSchema.parse({
    firstName: v.firstName.trim(),
    lastName: v.lastName.trim(),
    middleName: opt(v.middleName),
    dob: opt(v.dob),
    gender: optEnum(v.gender),
    phone: optPhone(v.phone),
    phoneAlt: optPhone(v.phoneAlt),
    address: opt(v.address),
    passportId: opt(v.passportId),
    bloodGroup: optEnum(v.bloodGroup),
    allergies: v.allergies,
    chronicConditions: v.chronicConditions,
    notes: opt(v.notes),
    source: optEnum(v.source),
    tags: v.tags,
  });
}

// ------------------------------------------------------------- component

export interface PatientFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the dialog edits this patient instead of creating a new one. */
  patient?: Patient;
}

export function PatientFormDialog({ open, onOpenChange, patient }: PatientFormDialogProps) {
  const t = useTranslations('patients');
  const router = useRouter();
  const queryClient = useQueryClient();
  const toastError = useApiErrorToast();

  const schema = useMemo(
    () => buildFormSchema({ required: t('form.required'), invalidPhone: t('form.invalidPhone') }),
    [t],
  );

  const form = useForm<PatientFormValues>({
    resolver: zodResolver(schema),
    defaultValues: patient ? valuesFromPatient(patient) : emptyValues(),
  });

  useEffect(() => {
    if (open) form.reset(patient ? valuesFromPatient(patient) : emptyValues());
  }, [open, patient?.id]);

  const [duplicates, setDuplicates] = useState<DuplicateCandidate[] | null>(null);
  const [pendingPayload, setPendingPayload] = useState<CreatePatientInput | null>(null);

  const createMutation = useMutation({
    mutationFn: ({ input, force }: { input: CreatePatientInput; force: boolean }) =>
      patientsApi.create(input, force),
    onSuccess: (res) => {
      toast.success(t('created'));
      void queryClient.invalidateQueries({ queryKey: ['patients'] });
      setDuplicates(null);
      setPendingPayload(null);
      onOpenChange(false);
      router.push(`/patients/${res.data.id}`);
    },
    onError: (err, vars) => {
      if (err instanceof ApiError && err.code === 'DUPLICATE_PATIENT') {
        setPendingPayload(vars.input);
        setDuplicates((err.details ?? []) as DuplicateCandidate[]);
        return;
      }
      toastError(err);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (input: CreatePatientInput) => patientsApi.update(patient?.id ?? '', input),
    onSuccess: () => {
      toast.success(t('updated'));
      void queryClient.invalidateQueries({ queryKey: ['patients'] });
      onOpenChange(false);
    },
    onError: toastError,
  });

  const submitting = createMutation.isPending || updateMutation.isPending;

  const onSubmit = form.handleSubmit((values) => {
    const payload = toPayload(values);
    if (patient) updateMutation.mutate(payload);
    else createMutation.mutate({ input: payload, force: false });
  });

  // -- chips local state
  const [allergyName, setAllergyName] = useState('');
  const [allergySeverity, setAllergySeverity] = useState<'low' | 'medium' | 'high'>('medium');
  const [conditionText, setConditionText] = useState('');

  const allergies = form.watch('allergies');
  const chronicConditions = form.watch('chronicConditions');
  const tags = form.watch('tags');

  const addAllergy = () => {
    const name = allergyName.trim();
    if (!name) return;
    form.setValue('allergies', [...allergies, { name, severity: allergySeverity }]);
    setAllergyName('');
  };

  const addCondition = () => {
    const name = conditionText.trim();
    if (!name) return;
    form.setValue('chronicConditions', [...chronicConditions, name]);
    setConditionText('');
  };

  const toggleTag = (tag: string) => {
    form.setValue('tags', tags.includes(tag) ? tags.filter((x) => x !== tag) : [...tags, tag]);
  };

  const err = form.formState.errors;

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{patient ? t('form.editTitle') : t('form.createTitle')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="pf-lastName">{t('form.lastName')} *</Label>
                <Input id="pf-lastName" {...form.register('lastName')} />
                {err.lastName ? (
                  <p className="text-xs text-destructive">{err.lastName.message}</p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pf-firstName">{t('form.firstName')} *</Label>
                <Input id="pf-firstName" {...form.register('firstName')} />
                {err.firstName ? (
                  <p className="text-xs text-destructive">{err.firstName.message}</p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pf-middleName">{t('form.middleName')}</Label>
                <Input id="pf-middleName" {...form.register('middleName')} />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Controller
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <div className="space-y-1.5">
                    <Label htmlFor="pf-phone">{t('form.phone')}</Label>
                    <Input
                      id="pf-phone"
                      inputMode="tel"
                      placeholder="+998 90 123-45-67"
                      value={field.value}
                      onChange={(e) => field.onChange(maskPhone(e.target.value))}
                    />
                    {err.phone ? (
                      <p className="text-xs text-destructive">{err.phone.message}</p>
                    ) : null}
                  </div>
                )}
              />
              <Controller
                control={form.control}
                name="phoneAlt"
                render={({ field }) => (
                  <div className="space-y-1.5">
                    <Label htmlFor="pf-phoneAlt">{t('form.phoneAlt')}</Label>
                    <Input
                      id="pf-phoneAlt"
                      inputMode="tel"
                      placeholder="+998 90 123-45-67"
                      value={field.value}
                      onChange={(e) => field.onChange(maskPhone(e.target.value))}
                    />
                    {err.phoneAlt ? (
                      <p className="text-xs text-destructive">{err.phoneAlt.message}</p>
                    ) : null}
                  </div>
                )}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="pf-dob">{t('form.dob')}</Label>
                <Input id="pf-dob" type="date" {...form.register('dob')} />
              </div>
              <Controller
                control={form.control}
                name="gender"
                render={({ field }) => (
                  <div className="space-y-1.5">
                    <Label>{t('form.gender')}</Label>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue placeholder={t('form.selectPlaceholder')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={UNSET}>{t('form.none')}</SelectItem>
                        {Object.values(Gender).map((g) => (
                          <SelectItem key={g} value={g}>
                            {t(`gender.${g}` as never)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              />
              <Controller
                control={form.control}
                name="bloodGroup"
                render={({ field }) => (
                  <div className="space-y-1.5">
                    <Label>{t('form.bloodGroup')}</Label>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue placeholder={t('form.selectPlaceholder')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={UNSET}>{t('form.none')}</SelectItem>
                        {Object.values(BloodGroup)
                          .filter((b) => b !== 'UNKNOWN')
                          .map((b) => (
                            <SelectItem key={b} value={b}>
                              {t(`blood.${b}` as never)}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pf-address">{t('form.address')}</Label>
                <Input id="pf-address" {...form.register('address')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pf-passport">{t('form.passportId')}</Label>
                <Input id="pf-passport" {...form.register('passportId')} />
              </div>
            </div>

            {/* Allergies chips */}
            <div className="space-y-1.5">
              <Label>{t('form.allergies')}</Label>
              <div className="flex flex-wrap gap-1.5">
                {allergies.map((a: PatientAllergy, i: number) => (
                  <Badge key={`${a.name}-${i}`} variant="outline" className="gap-1 border-destructive/40 bg-destructive/10 text-destructive">
                    {a.name}
                    {a.severity ? ` · ${t(`severity.${a.severity}` as never)}` : ''}
                    <button
                      type="button"
                      aria-label={t('form.remove')}
                      onClick={() =>
                        form.setValue(
                          'allergies',
                          allergies.filter((_: PatientAllergy, j: number) => j !== i),
                        )
                      }
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  value={allergyName}
                  placeholder={t('form.allergyName')}
                  onChange={(e) => setAllergyName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addAllergy();
                    }
                  }}
                />
                <Select
                  value={allergySeverity}
                  onValueChange={(v) => setAllergySeverity(v as 'low' | 'medium' | 'high')}
                >
                  <SelectTrigger className="w-36 shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(['low', 'medium', 'high'] as const).map((s) => (
                      <SelectItem key={s} value={s}>
                        {t(`severity.${s}` as never)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" variant="outline" onClick={addAllergy}>
                  {t('form.add')}
                </Button>
              </div>
            </div>

            {/* Chronic conditions chips */}
            <div className="space-y-1.5">
              <Label>{t('form.chronicConditions')}</Label>
              <div className="flex flex-wrap gap-1.5">
                {chronicConditions.map((c: string, i: number) => (
                  <Badge key={`${c}-${i}`} variant="secondary" className="gap-1">
                    {c}
                    <button
                      type="button"
                      aria-label={t('form.remove')}
                      onClick={() =>
                        form.setValue(
                          'chronicConditions',
                          chronicConditions.filter((_: string, j: number) => j !== i),
                        )
                      }
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  value={conditionText}
                  placeholder={t('form.conditionPlaceholder')}
                  onChange={(e) => setConditionText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addCondition();
                    }
                  }}
                />
                <Button type="button" variant="outline" onClick={addCondition}>
                  {t('form.add')}
                </Button>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Controller
                control={form.control}
                name="source"
                render={({ field }) => (
                  <div className="space-y-1.5">
                    <Label>{t('form.source')}</Label>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue placeholder={t('form.selectPlaceholder')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={UNSET}>{t('form.none')}</SelectItem>
                        {PATIENT_SOURCES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {t(`sources.${s}` as never)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              />
              <div className="space-y-1.5">
                <Label>{t('form.tags')}</Label>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {PATIENT_TAGS.map((tag) => (
                    <button key={tag} type="button" onClick={() => toggleTag(tag)}>
                      <Badge
                        variant={tags.includes(tag) ? 'default' : 'outline'}
                        className={cn('cursor-pointer', !tags.includes(tag) && 'text-muted-foreground')}
                      >
                        {t(`tags.${tag}` as never)}
                      </Badge>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pf-notes">{t('form.notes')}</Label>
              <Textarea id="pf-notes" rows={3} {...form.register('notes')} />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
                {t('form.cancel')}
              </Button>
              <Button type="submit" disabled={submitting}>
                {patient ? t('form.save') : t('form.create')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Duplicate conflict dialog */}
      <Dialog open={duplicates !== null} onOpenChange={(o) => !o && setDuplicates(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('duplicates.title')}</DialogTitle>
            <DialogDescription>{t('duplicates.description')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {(duplicates ?? []).map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between rounded-md border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.fullName}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.mrn}
                    {c.phone ? ` · ${formatPhone(c.phone)}` : ''}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDuplicates(null);
                    onOpenChange(false);
                    router.push(`/patients/${c.id}`);
                  }}
                >
                  {t('duplicates.open')}
                </Button>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDuplicates(null)} disabled={submitting}>
              {t('form.cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={submitting}
              onClick={() => {
                if (pendingPayload) createMutation.mutate({ input: pendingPayload, force: true });
              }}
            >
              {t('duplicates.forceCreate')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
