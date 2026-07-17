'use client';

import { useTranslations } from 'next-intl';
import { AlertTriangle, UserRound } from 'lucide-react';
import type { QueueTicketPayload } from '@avishifo/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/empty-state';
import { StatusBadge } from '@/components/status-badge';
import { Link } from '@/i18n/routing';
import { formatDate, formatTz } from '@/lib/dates';
import { parseAllergies } from '../api';
import { usePatientCard, usePatientLastVisits } from '../hooks';

export function PatientSummary({ ticket }: { ticket: QueueTicketPayload | null }) {
  const t = useTranslations('doctor');
  const patientId = ticket?.patientId ?? null;
  const { data: patient, isLoading } = usePatientCard(patientId);
  const { data: lastVisits, isLoading: visitsLoading } = usePatientLastVisits(patientId);

  if (!ticket) {
    return (
      <Card className="h-full">
        <CardContent className="flex h-full items-center justify-center p-6">
          <EmptyState
            icon={UserRound}
            title={t('noCurrentPatient')}
            description={t('noCurrentPatientDesc')}
            className="border-none"
          />
        </CardContent>
      </Card>
    );
  }

  const allergies = patient ? parseAllergies(patient.allergies) : [];

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-lg">{t('currentPatient')}</CardTitle>
          <StatusBadge status={ticket.status} label={t(`status.${ticket.status}` as never)} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading || !patient ? (
          <div className="space-y-2">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : (
          <>
            <div>
              <p className="text-xl font-semibold">{patient.fullName}</p>
              <p className="text-sm text-muted-foreground">
                {patient.mrn}
                {patient.dob ? ` · ${formatDate(patient.dob)}` : ''}
                {typeof patient.age === 'number' ? ` · ${t('ageYears', { age: patient.age })}` : ''}
                {patient.phone ? ` · ${patient.phone}` : ''}
              </p>
            </div>

            {allergies.length > 0 ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3">
                <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                  {t('allergies')}
                </p>
                <ul className="mt-1 space-y-0.5 text-sm text-destructive">
                  {allergies.map((a) => (
                    <li key={a.name}>
                      {a.name}
                      {a.note ? ` — ${a.note}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t('noAllergies')}</p>
            )}

            {patient.chronicConditions.length > 0 ? (
              <div>
                <p className="mb-1 text-sm font-medium">{t('chronic')}</p>
                <div className="flex flex-wrap gap-1">
                  {patient.chronicConditions.map((c) => (
                    <Badge key={c} variant="secondary">
                      {c}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}

            <div>
              <p className="mb-2 text-sm font-medium">{t('lastVisits')}</p>
              {visitsLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : !lastVisits || lastVisits.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('noVisits')}</p>
              ) : (
                <ul className="space-y-1.5">
                  {lastVisits.map((v) => (
                    <li
                      key={v.id}
                      className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                    >
                      <span>
                        {v.startedAt ? formatTz(v.startedAt) : '—'}
                        <span className="text-muted-foreground"> · {v.doctor.fullName}</span>
                      </span>
                      <Link
                        href={`/doctor/visits/${v.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {t('openVisit')}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
