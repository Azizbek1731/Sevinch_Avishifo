'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  ArrowRight,
  BedDouble,
  ClipboardList,
  FlaskConical,
  ListPlus,
  Receipt,
  UserPlus,
  Stethoscope,
  Activity,
} from 'lucide-react';
import { Link } from '@/i18n/routing';
import { SINGLE_CLINIC_MODE } from '@/lib/deployment';
import { useAuthStore } from '@/stores/auth-store';
import { useSocket, useSocketEvent } from '@/hooks/use-socket';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/page-header';
import { AddServicesDialog } from '@/features/billing/components/add-services-dialog';
import { AdmitDialog } from '@/features/admissions/components/admit-dialog';
import { AdmitPickerDialog } from '@/features/admissions/components/admit-picker-dialog';
import { AppointmentsPanel } from './appointments-panel';
import { QueuePanel } from './queue-panel';
import { NewPatientDialog } from './new-patient-dialog';
import { WalkInDialog } from './walk-in-dialog';
import { ClinicalOrderDialog } from '@/features/clinical-orders/components/order-dialog';
import { ClinicalWorklist } from '@/features/clinical-orders/components/worklist';
import type { ClinicalKind } from '@/features/clinical-orders/api';

export function ReceptionDashboard() {
  const t = useTranslations('reception');
  const tClinical = useTranslations('doctor.clinical');
  const qc = useQueryClient();
  const branchId = useAuthStore((s) => s.activeBranchId);
  const permissions = useAuthStore((s) => s.user?.permissions);
  const canCreatePatient = Boolean(permissions?.includes('patients.write'));
  const canWalkIn = !SINGLE_CLINIC_MODE && Boolean(permissions?.includes('appointments.write'));
  const canSell = Boolean(permissions?.includes('invoices.write'));
  const canAdmit = Boolean(permissions?.includes('admissions.write'));

  const [clinicalKind, setClinicalKind] = useState<ClinicalKind | null>(null);
  const [newPatientOpen, setNewPatientOpen] = useState(false);
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [addServicesOpen, setAddServicesOpen] = useState(false);
  const [serviceKind, setServiceKind] = useState<'LAB' | undefined>();
  const [admitPickerOpen, setAdmitPickerOpen] = useState(false);
  const [admitPatient, setAdmitPatient] = useState<{ id: string; fullName: string } | null>(null);

  // Join the branch queue room so ticket events reach this screen.
  const { socket, connected } = useSocket();
  useEffect(() => {
    if (socket && connected && branchId) socket.emit('queue.subscribe', { branchId });
  }, [socket, connected, branchId]);

  // WS is a change signal only — REST stays the source of truth.
  const invalidateQueue = () => {
    void qc.invalidateQueries({ queryKey: ['queue', 'snapshot'] });
  };
  useSocketEvent('queue.ticket.created', invalidateQueue);
  useSocketEvent('queue.ticket.updated', invalidateQueue);
  useSocketEvent('queue.ticket.called', invalidateQueue);
  useSocketEvent('appointment.updated', () => {
    void qc.invalidateQueries({ queryKey: ['appointments'] });
  });
  useSocketEvent('invoice.paid', () => {
    void qc.invalidateQueries({ queryKey: ['invoices'] });
    void qc.invalidateQueries({ queryKey: ['clinical-orders'] });
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('title')}
        description={t(SINGLE_CLINIC_MODE ? 'singleClinicSubtitle' : 'subtitle')}
      >
        {canCreatePatient ? (
          <Button variant="outline" onClick={() => setNewPatientOpen(true)}>
            <UserPlus className="mr-2 h-4 w-4" />
            {t('newPatient.button')}
          </Button>
        ) : null}
        {canWalkIn ? (
          <Button onClick={() => setWalkInOpen(true)}>
            <ListPlus className="mr-2 h-4 w-4" />
            {t('walkIn.button')}
          </Button>
        ) : null}
      </PageHeader>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {canSell ? (
          <>
            <button
              type="button"
              className="rounded-xl border bg-card p-5 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
              onClick={() => setClinicalKind('CONSULTATION')}
            >
              <Stethoscope className="mb-4 h-6 w-6 text-primary" />
              <p className="font-semibold">{tClinical('newConsultation')}</p>
              <p className="mt-1 text-sm text-muted-foreground">{tClinical('handoff')}</p>
            </button>
            <button
              type="button"
              className="rounded-xl border bg-card p-5 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
              onClick={() => setClinicalKind('ULTRASOUND')}
            >
              <Activity className="mb-4 h-6 w-6 text-primary" />
              <p className="font-semibold">{tClinical('newUltrasound')}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t('workflow.uziHint')}</p>
            </button>
            <button
              type="button"
              className="rounded-xl border bg-card p-5 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
              onClick={() => {
                setServiceKind(undefined);
                setAddServicesOpen(true);
              }}
            >
              <ClipboardList className="mb-4 h-6 w-6 text-primary" />
              <p className="font-semibold">{t('workflow.services')}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t('workflow.servicesHint')}</p>
            </button>
            <button
              type="button"
              className="rounded-xl border bg-card p-5 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
              onClick={() => {
                setServiceKind('LAB');
                setAddServicesOpen(true);
              }}
            >
              <FlaskConical className="mb-4 h-6 w-6 text-primary" />
              <p className="font-semibold">{t('workflow.lab')}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t(SINGLE_CLINIC_MODE ? 'workflow.labPaidHint' : 'workflow.labHint')}
              </p>
            </button>
          </>
        ) : null}
        {canAdmit ? (
          <button
            type="button"
            className="rounded-xl border bg-card p-5 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
            onClick={() => setAdmitPickerOpen(true)}
          >
            <BedDouble className="mb-4 h-6 w-6 text-primary" />
            <p className="font-semibold">{t('workflow.admit')}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t('workflow.admitHint')}</p>
          </button>
        ) : null}
        {permissions?.includes('admissions.read') ? (
          <Link
            href="/admissions"
            className="rounded-xl border bg-card p-5 transition-colors hover:border-primary/50 hover:bg-primary/5"
          >
            <Receipt className="mb-4 h-6 w-6 text-primary" />
            <p className="font-semibold">{t('workflow.ward')}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t('workflow.wardHint')}</p>
          </Link>
        ) : null}
      </div>

      {canSell ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 px-4 py-3">
          <p className="max-w-3xl text-sm text-muted-foreground">{t('workflow.handoff')}</p>
          <Button variant="outline" size="sm" asChild>
            <Link href="/invoices">
              {t('workflow.invoices')}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      ) : null}

      {canSell ? <ClinicalWorklist reception /> : null}

      {!SINGLE_CLINIC_MODE ? (
        <div className="grid items-start gap-4 xl:grid-cols-2">
          <AppointmentsPanel />
          <QueuePanel />
        </div>
      ) : null}

      {clinicalKind ? (
        <ClinicalOrderDialog
          open
          kind={clinicalKind}
          onOpenChange={(open) => {
            if (!open) setClinicalKind(null);
          }}
        />
      ) : null}
      <NewPatientDialog open={newPatientOpen} onOpenChange={setNewPatientOpen} />
      {!SINGLE_CLINIC_MODE ? <WalkInDialog open={walkInOpen} onOpenChange={setWalkInOpen} /> : null}
      <AddServicesDialog
        key={serviceKind === 'LAB' ? 'laboratory' : 'procedures'}
        open={addServicesOpen}
        onOpenChange={setAddServicesOpen}
        initialKind={serviceKind}
        prepareOnly
      />
      <AdmitPickerDialog
        open={admitPickerOpen}
        onOpenChange={setAdmitPickerOpen}
        onPick={setAdmitPatient}
      />
      {admitPatient ? (
        <AdmitDialog
          open
          onOpenChange={(open) => {
            if (!open) setAdmitPatient(null);
          }}
          patientId={admitPatient.id}
          patientName={admitPatient.fullName}
        />
      ) : null}
    </div>
  );
}
