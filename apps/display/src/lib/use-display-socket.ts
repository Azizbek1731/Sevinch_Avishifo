'use client';

import { useEffect, useRef, useState } from 'react';
import type { QueueTicketPayload } from '@avishifo/shared';
import { createDisplaySocket, isAuthConnectError } from './socket';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

export interface DisplaySocketHandlers {
  /** Fired on every `queue.ticket.called` (including repeat announcements). */
  onCalled: (ticket: QueueTicketPayload, room: string | null, repeat: boolean) => void;
  /** Server rejected the handshake — the display token is invalid/expired. */
  onAuthError: () => void;
}

export interface DisplaySocketState {
  connection: ConnectionState;
  /** Ticket map keyed by id; replaced wholesale on every `queue.snapshot`. */
  tickets: Record<string, QueueTicketPayload>;
  /** Id of the ticket from the most recent `queue.ticket.called` event. */
  lastCalledId: string | null;
}

/**
 * Connects to the queue gateway with a display token. The server auto-joins
 * the branch display rooms and re-sends `queue.snapshot` on every (re)connect,
 * so no explicit subscribe emit is needed. Passing `token = null` keeps the
 * hook idle (state stays 'connecting' until the token is loaded from storage).
 */
export function useDisplaySocket(
  token: string | null,
  handlers: DisplaySocketHandlers,
): DisplaySocketState {
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [tickets, setTickets] = useState<Record<string, QueueTicketPayload>>({});
  const [lastCalledId, setLastCalledId] = useState<string | null>(null);
  const handlersRef = useRef<DisplaySocketHandlers>(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    if (token === null) return undefined;

    const socket = createDisplaySocket(token);

    const upsert = (ticket: QueueTicketPayload): void => {
      setTickets((previous) => ({ ...previous, [ticket.id]: ticket }));
    };

    socket.on('connect', () => setConnection('connected'));
    socket.on('disconnect', () => setConnection('disconnected'));
    socket.on('connect_error', (error) => {
      if (isAuthConnectError(error)) {
        socket.disconnect();
        handlersRef.current.onAuthError();
      } else {
        setConnection('disconnected');
      }
    });

    socket.on('queue.snapshot', ({ tickets: snapshot }) => {
      const next: Record<string, QueueTicketPayload> = {};
      for (const ticket of snapshot) next[ticket.id] = ticket;
      setTickets(next);
    });
    socket.on('queue.ticket.created', ({ ticket }) => upsert(ticket));
    socket.on('queue.ticket.updated', ({ ticket }) => upsert(ticket));
    socket.on('queue.ticket.called', ({ ticket, room, repeat }) => {
      upsert(ticket);
      setLastCalledId(ticket.id);
      handlersRef.current.onCalled(ticket, room, repeat);
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [token]);

  return { connection, tickets, lastCalledId };
}
