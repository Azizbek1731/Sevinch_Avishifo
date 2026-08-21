'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowLeft, LogOut, Plus, Printer } from 'lucide-react';
import { formatTz } from '@/lib/dates';
import { Link, useRouter } from '@/i18n/routing';
import { usePermissions } from '@/hooks/use-permissions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useApiErrorToast } from '@/features/services/hooks';
import { admissionsApi } from '../api';
import { TreatmentSheet } from './treatment-sheet';
import { OrderDialog } from './order-dialog';
import { DischargeDialog } from './discharge-dialog';

/** One field of the 003 narrative, saved when it loses focus. */
function NarrativeField({
  label,
  value,
  onSave,
  readOnly,
  rows = 3,
}: {
  label: string;
  value: string | null;
  onSave: (v: string) => void;
  readOnly: boolean;
  rows?: number;
}) {
  const [draft, setDraft] = useState(value ?? '');
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Textarea
        rows={rows}
        value={draft}
        readOnly={readOnly}
        onChange={(e) => setDraft(e.target.value)}
        // Saved on blur rather than per keystroke: a doctor writing an
        // anamnesis should not generate a request per character.
        onBlur={() => {
          if (draft !== (value ?? '')) onSave(draft);
        }}
      />
    </div>
  );
}

export function AdmissionDetail({ admissionId }: { admissionId: string }) {
  const t = useTranslations('admissions');
  const can = usePermissions();
  const router = useRouter();
  const queryClient = useQueryClient();
  const errorToast = useApiErrorToast();

  const [orderOpen, setOrderOpen] = useState(false);
  const [dischargeOpen, setDischargeOpen] = useState(false);
  const [note, setNote] = useState({ condition: '', temperatureC: '', pulseBpm: '' });

  const query = useQuery({
    queryKey: ['admission', admissionId],
    queryFn: async () => (await admissionsApi.get(admissionId)).data,
  });

  const save = useMutation({
    mutationFn: (patch: Record<string, string>) => admissionsApi.update(admissionId, patch),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admission', admissionId] }),
    onError: errorToast,
  });

  const addNote = useMutation({
    mutationFn: () =>
      admissionsApi.addNote(admissionId, {
        date: new Date().toISOString().slice(0, 10),
        condition: note.condition,
        temperatureC: note.temperatureC ? Number(note.temperatureC) : undefined,
        pulseBpm: note.pulseBpm ? Number(note.pulseBpm) : undefined,
      } as never),
    onSuccess: () => {
      setNote({ condition: '', temperatureC: '', pulseBpm: '' });
      void queryClient.invalidateQueries({ queryKey: ['admission', admissionId] });
      toast.success(t('noteAdded'));
    },
    onError: errorToast,
  });

  if (query.isLoading) return <Skeleton className="h-96 w-full" />;
  const a = query.data;
  if (!a) return null;

  const closed = a.status === 'DISCHARGED';
  const canWrite = can('admissions.write') && !closed;
  const field = (key: string) => (v: string) => save.mutate({ [key]: v });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" asChild className="-ml-2 mb-1">
            <Link href="/admissions">
              <ArrowLeft className="mr-1 h-4 w-4" />
              {t('back')}
            </Link>
          </Button>
          <h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight">
            {a.patient?.fullName ?? '—'}
            <Badge variant={closed ? 'outline' : 'default'}>{t(`status.${a.status}`)}</Badge>
          </h1>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono">{a.historyNumber}</span>
            {' · '}
            {[a.department, a.ward && `${t('fields.ward')} ${a.ward}`, a.bed && `№${a.bed}`]
              .filter(Boolean)
              .join(' · ')}
            {' · '}
            {formatTz(a.admittedAt)}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href={`/admissions/${admissionId}/print`}>
              <Printer className="mr-2 h-4 w-4" />
              {t('print')}
            </Link>
          </Button>
          {canWrite ? (
            <Button variant="destructive" onClick={() => setDischargeOpen(true)}>
              <LogOut className="mr-2 h-4 w-4" />
              {t('discharge')}
            </Button>
          ) : null}
        </div>
      </div>

      <Tabs defaultValue="sheet">
        <TabsList className="flex h-auto w-full flex-wrap justify-start">
          <TabsTrigger value="sheet">{t('tabs.sheet')}</TabsTrigger>
          <TabsTrigger value="history">{t('tabs.history')}</TabsTrigger>
          <TabsTrigger value="notes">{t('tabs.notes')}</TabsTrigger>
        </TabsList>

        <TabsContent value="sheet" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <CardTitle className="text-base">{t('tabs.sheet')}</CardTitle>
              {canWrite ? (
                <Button size="sm" onClick={() => setOrderOpen(true)}>
                  <Plus className="mr-1 h-4 w-4" />
                  {t('addOrder')}
                </Button>
              ) : null}
            </CardHeader>
            <CardContent>
              <TreatmentSheet admissionId={admissionId} orders={a.orders} readOnly={closed} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('sections.diagnoses')}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <NarrativeField label={t('fields.referralDiagnosis')} value={a.referralDiagnosis} onSave={field('referralDiagnosis')} readOnly={!canWrite} rows={2} />
              <NarrativeField label={t('fields.admissionDiagnosis')} value={a.admissionDiagnosis} onSave={field('admissionDiagnosis')} readOnly={!canWrite} rows={2} />
              <NarrativeField label={t('fields.clinicalDiagnosis')} value={a.clinicalDiagnosis} onSave={field('clinicalDiagnosis')} readOnly={!canWrite} rows={2} />
              <NarrativeField label={t('fields.preliminaryDiagnosis')} value={a.preliminaryDiagnosis} onSave={field('preliminaryDiagnosis')} readOnly={!canWrite} rows={2} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('sections.anamnesis')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <NarrativeField label={t('fields.complaints')} value={a.complaints} onSave={field('complaints')} readOnly={!canWrite} />
              <NarrativeField label={t('fields.anamnesisMorbi')} value={a.anamnesisMorbi} onSave={field('anamnesisMorbi')} readOnly={!canWrite} rows={4} />
              <NarrativeField label={t('fields.anamnesisVitae')} value={a.anamnesisVitae} onSave={field('anamnesisVitae')} readOnly={!canWrite} rows={4} />
              <NarrativeField label={t('fields.objectiveStatus')} value={a.objectiveStatus} onSave={field('objectiveStatus')} readOnly={!canWrite} rows={5} />
              <NarrativeField label={t('fields.treatmentPlan')} value={a.treatmentPlan} onSave={field('treatmentPlan')} readOnly={!canWrite} />
              <NarrativeField label={t('fields.epicrisis')} value={a.epicrisis} onSave={field('epicrisis')} readOnly={!canWrite} rows={5} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notes" className="mt-4 space-y-4">
          {canWrite ? (
            <Card>
              <CardContent className="space-y-3 p-4">
                <Textarea
                  rows={3}
                  placeholder={t('fields.condition')}
                  value={note.condition}
                  onChange={(e) => setNote((n) => ({ ...n, condition: e.target.value }))}
                />
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="n-t">{t('fields.temperature')}</Label>
                    <Input id="n-t" inputMode="decimal" className="w-24" value={note.temperatureC}
                      onChange={(e) => setNote((n) => ({ ...n, temperatureC: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="n-p">{t('fields.pulse')}</Label>
                    <Input id="n-p" inputMode="numeric" className="w-24" value={note.pulseBpm}
                      onChange={(e) => setNote((n) => ({ ...n, pulseBpm: e.target.value }))} />
                  </div>
                  <Button
                    className="ml-auto"
                    disabled={!note.condition.trim() || addNote.isPending}
                    onClick={() => addNote.mutate()}
                  >
                    {t('addNote')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {a.dailyNotes.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('noNotes')}</p>
          ) : (
            <div className="space-y-3">
              {[...a.dailyNotes].reverse().map((n) => (
                <Card key={n.id}>
                  <CardContent className="p-4">
                    <div className="mb-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{n.date}</span>
                      {n.temperatureC ? <span>t° {n.temperatureC}</span> : null}
                      {n.pulseBpm ? <span>Ps {n.pulseBpm}</span> : null}
                      {n.bpSystolic && n.bpDiastolic ? <span>AD {n.bpSystolic}/{n.bpDiastolic}</span> : null}
                    </div>
                    <p className="whitespace-pre-wrap text-sm">{n.condition}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <OrderDialog open={orderOpen} onOpenChange={setOrderOpen} admissionId={admissionId} />
      <DischargeDialog
        open={dischargeOpen}
        onOpenChange={setDischargeOpen}
        admissionId={admissionId}
        onDone={() => router.push('/admissions')}
      />
    </div>
  );
}
