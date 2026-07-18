'use client';

import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@avishifo/shared';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Same-origin by default (nginx proxies /socket.io → backend); override with NEXT_PUBLIC_WS_URL. */
function resolveWsOrigin(): string {
  const env = process.env.NEXT_PUBLIC_WS_URL;
  if (env && env.length > 0) return env;
  if (typeof window !== 'undefined') return window.location.origin;
  return 'http://localhost:3001';
}

let socket: AppSocket | null = null;
let currentToken: string | null = null;

/** Singleton typed socket; reconnects with a new token when it changes. */
export function getSocket(accessToken: string): AppSocket {
  if (socket && currentToken === accessToken) return socket;
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  currentToken = accessToken;
  socket = io(resolveWsOrigin(), {
    auth: { token: accessToken },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10_000,
  });
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
  currentToken = null;
}
