'use client';

import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { QueueStatsPayload, TicketPriority } from '@avishifo/shared';
import { ApiError } from '@/lib/api-client';
import { useSocket, useSocketEvent } from '@/hooks/use-socket';
import { useAuthStore } from '@/stores/auth-store';
import { queueApi } from './api';

/** Map an ApiError to a translated toast via the `errors` namespace. */
export function useApiErrorToast(): (err: unknown) => void {
  const tErrors = useTranslations('errors');
  return useCallback(
    (err: unknown) => {
      const code = err instanceof ApiError ? err.code : 'INTERNAL_ERROR';
      toast.error(tErrors.has(code) ? tErrors(code) : tErrors('INTERNAL_ERROR'));
    },
    [tErrors],
  );
}

/** Current time, re-evaluated every `intervalMs` — drives live wait-time ticking. */
export function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * Branch queue board data: REST query (source of truth) + WS subscription that
 * invalidates it on every ticket event. Falls back to 15 s polling when the
 * socket is down.
 */
export function useQueueBoard(date: string) {
  const branchId = useAuthStore((s) => s.activeBranchId);
  const queryClient = useQueryClient();
  const { socket, connected } = useSocket();

  useEffect(() => {
    if (!socket || !connected || !branchId) return;
    socket.emit('queue.subscribe', { branchId });
  }, [socket, connected, branchId]);

  const invalidate = useCallback(
    (eventBranchId: string) => {
      if (branchId && eventBranchId === branchId) {
        void queryClient.invalidateQueries({ queryKey: ['queue', 'board', branchId] });
      }
    },
    [branchId, queryClient],
  );

  useSocketEvent('queue.ticket.created', (p) => invalidate(p.ticket.branchId));
  useSocketEvent('queue.ticket.updated', (p) => invalidate(p.ticket.branchId));
  useSocketEvent('queue.ticket.called', (p) => invalidate(p.ticket.branchId));

  const query = useQuery({
    queryKey: ['queue', 'board', branchId, date],
    queryFn: () => queueApi.list(branchId as string, date),
    enabled: Boolean(branchId),
    refetchInterval: connected ? false : 15_000,
  });

  return { branchId, query, connected };
}

/** Live branch stats from the `queue.stats.updated` socket event. */
export function useQueueStats(): QueueStatsPayload | null {
  const branchId = useAuthStore((s) => s.activeBranchId);
  const [stats, setStats] = useState<QueueStatsPayload | null>(null);

  useEffect(() => {
    setStats(null);
  }, [branchId]);

  useSocketEvent('queue.stats.updated', (p) => {
    if (branchId && p.branchId === branchId) setStats(p);
  });

  return stats;
}

/** Rooms of the active branch (for the call-next room select). */
export function useRooms(enabled: boolean) {
  const branchId = useAuthStore((s) => s.activeBranchId);
  return useQuery({
    queryKey: ['queue', 'rooms', branchId],
    queryFn: () => queueApi.rooms(branchId as string),
    enabled: enabled && Boolean(branchId),
    staleTime: 5 * 60_000,
  });
}

function useInvalidateBoard(): () => void {
  const branchId = useAuthStore((s) => s.activeBranchId);
  const queryClient = useQueryClient();
  return useCallback(() => {
    if (branchId) void queryClient.invalidateQueries({ queryKey: ['queue', 'board', branchId] });
  }, [branchId, queryClient]);
}

export function useCallNext() {
  const t = useTranslations('queue');
  const invalidate = useInvalidateBoard();
  const onError = useApiErrorToast();
  return useMutation({
    mutationFn: ({ queueId, roomId }: { queueId: string; roomId?: string }) =>
      queueApi.callNext(queueId, roomId),
    onSuccess: (ticket) => {
      toast.success(t('toast.called', { number: ticket.ticketNumber }));
      invalidate();
    },
    onError,
  });
}

export type TicketActionInput =
  | { action: 'start' | 'finish' | 'skip' | 'recall'; ticketId: string }
  | { action: 'priority'; ticketId: string; priority: TicketPriority }
  | { action: 'transfer'; ticketId: string; targetDoctorUserId: string };

const ACTION_TOAST_KEY: Record<TicketActionInput['action'], string> = {
  start: 'started',
  finish: 'finished',
  skip: 'skipped',
  recall: 'recalled',
  priority: 'priorityChanged',
  transfer: 'transferred',
};

export function useTicketAction() {
  const t = useTranslations('queue');
  const invalidate = useInvalidateBoard();
  const onError = useApiErrorToast();
  return useMutation({
    mutationFn: (input: TicketActionInput) => {
      switch (input.action) {
        case 'start':
          return queueApi.start(input.ticketId);
        case 'finish':
          return queueApi.finish(input.ticketId);
        case 'skip':
          return queueApi.skip(input.ticketId);
        case 'recall':
          return queueApi.recall(input.ticketId);
        case 'priority':
          return queueApi.setPriority(input.ticketId, input.priority);
        case 'transfer':
          return queueApi.transfer(input.ticketId, input.targetDoctorUserId);
      }
    },
    onSuccess: (_ticket, input) => {
      toast.success(t(`toast.${ACTION_TOAST_KEY[input.action]}`));
      invalidate();
    },
    onError,
  });
}
