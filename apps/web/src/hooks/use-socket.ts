'use client';

import { useEffect, useRef, useState } from 'react';
import type { ServerEventName, ServerToClientEvents } from '@avishifo/shared';
import { getSocket, type AppSocket } from '@/lib/socket';
import { useAuthStore } from '@/stores/auth-store';

/** Connected socket for the current session (null while anonymous). */
export function useSocket(): { socket: AppSocket | null; connected: boolean } {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [connected, setConnected] = useState(false);
  const [sock, setSock] = useState<AppSocket | null>(null);

  useEffect(() => {
    if (!accessToken) {
      setSock(null);
      setConnected(false);
      return;
    }
    const s = getSocket(accessToken);
    setSock(s);
    setConnected(s.connected);
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    return () => {
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
    };
  }, [accessToken]);

  return { socket: sock, connected };
}

/** Subscribe to a typed server event; handler kept fresh via ref. */
export function useSocketEvent<E extends ServerEventName>(
  event: E,
  handler: ServerToClientEvents[E],
): void {
  const { socket } = useSocket();
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    if (!socket) return;
    const wrapped = ((...args: unknown[]) =>
      (ref.current as (...a: unknown[]) => void)(...args)) as ServerToClientEvents[E];
    socket.on(event, wrapped as never);
    return () => {
      socket.off(event, wrapped as never);
    };
  }, [socket, event]);
}
