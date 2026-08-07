'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ListPlus, Plus, UserPlus } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { useSocket, useSocketEvent } from '@/hooks/use-socket';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/page-header';
import { AddServicesDialog } from '@/features/billing/components/add-services-dialog';
import { PendingInvoicesTab } from '@/features/billing/components/pending-invoices-tab';
import { ShiftPanel } from '@/features/billing/components/shift-panel';
import { AppointmentsPanel } from './appointments-panel';
import { QueuePanel } from './queue-panel';
import { NewPatientDialog } from './new-patient-dialog';
import { WalkInDialog } from './walk-in-dialog';

export function ReceptionDashboard() {
  const t = useTranslations('reception');
  const tc = useTranslations('cashier');
  const qc = useQueryClient();
  const branchId = useAuthStore((s) => s.activeBranchId);
  const permissions = useAuthStore((s) => s.user?.permissions);
  const canCreatePatient = Boolean(permissions?.includes('patients.write'));
  const canWalkIn = Boolean(permissions?.includes('appointments.write'));
  // Most clinics run the cash desk from the front desk: sell the services and
  // take the money without leaving this screen.
  const canSell = Boolean(permissions?.includes('invoices.write'));
  const canCashier = Boolean(permissions?.includes('payments.create'));

  const [newPatientOpen, setNewPatientOpen] = useState(false);
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [addServicesOpen, setAddServicesOpen] = useState(false);

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
    void qc.invalidateQueries({ queryKey: ['shifts'] });
  });

  return (
    <div className="space-y-4">
      <PageHeader title={t('title')} description={t('subtitle')}>
        {canCreatePatient ? (
          <Button variant="outline" onClick={() => setNewPatientOpen(true)}>
            <UserPlus className="mr-2 h-4 w-4" />
            {t('newPatient.button')}
          </Button>
        ) : null}
        {canSell ? (
          <Button variant="outline" onClick={() => setAddServicesOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            {t('cashDesk.addServices')}
          </Button>
        ) : null}
        {canWalkIn ? (
          <Button onClick={() => setWalkInOpen(true)}>
            <ListPlus className="mr-2 h-4 w-4" />
            {t('walkIn.button')}
          </Button>
        ) : null}
      </PageHeader>

      {canCashier ? <ShiftPanel /> : null}

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <AppointmentsPanel />
        <QueuePanel />
      </div>

      {canCashier ? (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">{t('cashDesk.title')}</h2>
            <p className="text-sm text-muted-foreground">{tc('tabs.pending')}</p>
          </div>
          <PendingInvoicesTab />
        </section>
      ) : null}

      <NewPatientDialog open={newPatientOpen} onOpenChange={setNewPatientOpen} />
      <WalkInDialog open={walkInOpen} onOpenChange={setWalkInOpen} />
      <AddServicesDialog open={addServicesOpen} onOpenChange={setAddServicesOpen} />
    </div>
  );
}
