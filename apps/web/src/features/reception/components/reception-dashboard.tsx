'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ListPlus, UserPlus } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { useSocket, useSocketEvent } from '@/hooks/use-socket';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/page-header';
import { AppointmentsPanel } from './appointments-panel';
import { QueuePanel } from './queue-panel';
import { NewPatientDialog } from './new-patient-dialog';
import { WalkInDialog } from './walk-in-dialog';

export function ReceptionDashboard() {
  const t = useTranslations('reception');
  const qc = useQueryClient();
  const branchId = useAuthStore((s) => s.activeBranchId);
  const permissions = useAuthStore((s) => s.user?.permissions);
  const canCreatePatient = Boolean(permissions?.includes('patients.write'));
  const canWalkIn = Boolean(permissions?.includes('appointments.write'));

  const [newPatientOpen, setNewPatientOpen] = useState(false);
  const [walkInOpen, setWalkInOpen] = useState(false);

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

  return (
    <div className="space-y-4">
      <PageHeader title={t('title')} description={t('subtitle')}>
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

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <AppointmentsPanel />
        <QueuePanel />
      </div>

      <NewPatientDialog open={newPatientOpen} onOpenChange={setNewPatientOpen} />
      <WalkInDialog open={walkInOpen} onOpenChange={setWalkInOpen} />
    </div>
  );
}
