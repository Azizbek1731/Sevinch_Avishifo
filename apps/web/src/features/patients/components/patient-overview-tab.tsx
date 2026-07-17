'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { FileSignature } from 'lucide-react';
import { formatPhone } from '@avishifo/shared';
import { Badge } from '@/components/ui/badge';
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
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate, formatTz, tashkentToUtcIso, todayTashkent } from '@/lib/dates';
import { patientsApi, type PatientCard } from '../api';
import { useApiErrorToast, usePatientConsents, usePermissions } from '../hooks';

const CONSENT_TYPES = ['personal_data', 'treatment', 'other'] as const;

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value ?? '—'}</p>
    </div>
  );
}

export function PatientOverviewTab({ patient }: { patient: PatientCard }) {
  const t = useTranslations('patients');
  const can = usePermissions();
  const queryClient = useQueryClient();
  const toastError = useApiErrorToast();

  const consents = usePatientConsents(patient.id);

  const [consentType, setConsentType] = useState<string>('personal_data');
  const [consentDate, setConsentDate] = useState(todayTashkent());
  const [consentNote, setConsentNote] = useState('');

  const addConsent = useMutation({
    mutationFn: () =>
      patientsApi.addConsent(patient.id, {
        type: consentType,
        signedAt: tashkentToUtcIso(consentDate, '00:00'),
        note: consentNote.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success(t('overview.consentAdded'));
      setConsentNote('');
      void queryClient.invalidateQueries({ queryKey: ['patients', 'consents', patient.id] });
    },
    onError: toastError,
  });

  const allergies = Array.isArray(patient.allergies) ? patient.allergies : [];
  const chronic = Array.isArray(patient.chronicConditions) ? patient.chronicConditions : [];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Demographics */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('overview.demographics')}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <Field
            label={t('overview.dob')}
            value={
              patient.dob
                ? `${formatDate(patient.dob)}${
                    patient.age !== null ? ` (${t('card.ageYears', { age: patient.age })})` : ''
                  }`
                : '—'
            }
          />
          <Field
            label={t('overview.gender')}
            value={patient.gender ? t(`gender.${patient.gender}` as never) : '—'}
          />
          <Field
            label={t('overview.bloodGroup')}
            value={t(`blood.${patient.bloodGroup}` as never)}
          />
          <Field
            label={t('overview.phoneAlt')}
            value={patient.phoneAlt ? formatPhone(patient.phoneAlt) : '—'}
          />
          <Field label={t('overview.address')} value={patient.address ?? '—'} />
          <Field label={t('overview.passport')} value={patient.passportId ?? '—'} />
          <Field
            label={t('overview.source')}
            value={patient.source ? t(`sources.${patient.source}` as never) : '—'}
          />
          <Field label={t('overview.registeredAt')} value={formatDate(patient.createdAt)} />
        </CardContent>
      </Card>

      {/* Allergies & chronic conditions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('overview.allergies')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-1.5">
            {allergies.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('overview.noAllergies')}</p>
            ) : (
              allergies.map((a, i) => (
                <Badge
                  key={`${a.name}-${i}`}
                  variant="outline"
                  className="border-destructive/40 bg-destructive/10 text-destructive"
                >
                  {a.name}
                  {a.severity ? ` · ${t(`severity.${a.severity}` as never)}` : ''}
                </Badge>
              ))
            )}
          </div>
          <div>
            <p className="mb-1.5 text-sm font-medium">{t('overview.chronicConditions')}</p>
            <div className="flex flex-wrap gap-1.5">
              {chronic.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('overview.noChronic')}</p>
              ) : (
                chronic.map((c, i) => (
                  <Badge key={`${c}-${i}`} variant="secondary">
                    {c}
                  </Badge>
                ))
              )}
            </div>
          </div>
          <div>
            <p className="mb-1 text-sm font-medium">{t('overview.notes')}</p>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {patient.notes ?? t('overview.noNotes')}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Consents */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">{t('overview.consents')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {consents.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : (consents.data?.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('overview.noConsents')}</p>
          ) : (
            <ul className="space-y-2">
              {(consents.data?.data ?? []).map((c) => (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <FileSignature className="h-4 w-4 text-muted-foreground" />
                    {CONSENT_TYPES.includes(c.type as (typeof CONSENT_TYPES)[number])
                      ? t(`consentType.${c.type}` as never)
                      : c.type}
                    {c.note ? (
                      <span className="font-normal text-muted-foreground">— {c.note}</span>
                    ) : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t('overview.signedAt')}: {formatTz(c.signedAt, 'dd.MM.yyyy')}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {can('patients.write') ? (
            <form
              className="flex flex-wrap items-end gap-2 border-t pt-4"
              onSubmit={(e) => {
                e.preventDefault();
                addConsent.mutate();
              }}
            >
              <div className="space-y-1.5">
                <Label>{t('overview.consentType')}</Label>
                <Select value={consentType} onValueChange={setConsentType}>
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONSENT_TYPES.map((ct) => (
                      <SelectItem key={ct} value={ct}>
                        {t(`consentType.${ct}` as never)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="consent-date">{t('overview.signedAt')}</Label>
                <Input
                  id="consent-date"
                  type="date"
                  className="w-40"
                  value={consentDate}
                  onChange={(e) => setConsentDate(e.target.value)}
                />
              </div>
              <div className="min-w-48 flex-1 space-y-1.5">
                <Label htmlFor="consent-note">{t('overview.note')}</Label>
                <Input
                  id="consent-note"
                  value={consentNote}
                  onChange={(e) => setConsentNote(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={addConsent.isPending || !consentDate}>
                {t('overview.addConsent')}
              </Button>
            </form>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
