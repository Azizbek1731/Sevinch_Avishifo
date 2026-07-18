import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@avishifo/shared';

export type DisplaySocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Same-origin by default (nginx proxies /socket.io → backend); override with NEXT_PUBLIC_WS_URL. */
function resolveWsOrigin(): string {
  const env = process.env.NEXT_PUBLIC_WS_URL;
  if (env && env.length > 0) return env;
  if (typeof window !== 'undefined') return window.location.origin;
  return 'http://localhost:3001';
}

/**
 * Transport-level `connect_error` messages mean the server is unreachable
 * (network down, server restarting) — keep retrying. Anything else means the
 * server actively rejected the handshake, i.e. the display token is invalid.
 */
const TRANSPORT_ERROR_SNIPPETS = ['xhr poll error', 'websocket error', 'timeout', 'transport'];

export function isAuthConnectError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return !TRANSPORT_ERROR_SNIPPETS.some((snippet) => message.includes(snippet));
}

export function createDisplaySocket(token: string): DisplaySocket {
  return io(resolveWsOrigin(), {
    auth: { token },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10_000,
    // Default transports (polling → websocket upgrade): safest on smart-TV browsers.
  });
}
