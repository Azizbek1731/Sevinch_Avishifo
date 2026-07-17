'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TicketStatus } from '@avishifo/shared';
import type { QueueTicketPayload, TicketPriority } from '@avishifo/shared';
import { Clock } from '@/components/clock';
import { ConnectionStatus } from '@/components/connection-status';
import { HistoryStrip } from '@/components/history-strip';
import { NewsTicker } from '@/components/ticker';
import { TicketTile, type TileSize } from '@/components/ticket-tile';
import { WaitingList } from '@/components/waiting-list';
import { Announcer } from '@/lib/announcer';
import { clearDisplayToken, readDisplayToken } from '@/lib/storage';
import { useDisplaySocket } from '@/lib/use-display-socket';

const PRIORITY_RANK: Record<TicketPriority, number> = {
  EMERGENCY: 0,
  PRIORITY: 1,
  NORMAL: 2,
};

const WAITING_LIMIT = 8;
const HISTORY_LIMIT = 5;

export default function BoardPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const saved = readDisplayToken();
    if (saved === null) {
      router.replace('/?error=no-token');
      return;
    }
    setToken(saved);
  }, [router]);

  const announcerRef = useRef<Announcer | null>(null);

  const handleCalled = useCallback((ticket: QueueTicketPayload, room: string | null) => {
    announcerRef.current ??= new Announcer();
    announcerRef.current.announce(ticket.ticketNumber, room ?? ticket.roomNumber);
  }, []);

  const handleAuthError = useCallback(() => {
    clearDisplayToken();
    router.replace('/?error=auth');
  }, [router]);

  const handlers = useMemo(
    () => ({ onCalled: handleCalled, onAuthError: handleAuthError }),
    [handleCalled, handleAuthError],
  );

  const { connection, tickets, lastCalledId } = useDisplaySocket(token, handlers);

  const allTickets = useMemo(() => Object.values(tickets), [tickets]);

  /** "Now serving": CALLED + IN_ROOM, newest call first. */
  const active = useMemo(
    () =>
      allTickets
        .filter(
          (ticket) =>
            ticket.status === TicketStatus.CALLED || ticket.status === TicketStatus.IN_ROOM,
        )
        .sort((a, b) =>
          (b.calledAt ?? b.createdAt).localeCompare(a.calledAt ?? a.createdAt),
        ),
    [allTickets],
  );

  /** Next waiting tickets: priority first, then queue position. */
  const waiting = useMemo(
    () =>
      allTickets
        .filter((ticket) => ticket.status === TicketStatus.WAITING)
        .sort(
          (a, b) =>
            PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
            a.position - b.position ||
            a.createdAt.localeCompare(b.createdAt),
        )
        .slice(0, WAITING_LIMIT),
    [allTickets],
  );

  /** Recently called tickets that already left the main area (DONE/SKIPPED). */
  const history = useMemo(
    () =>
      allTickets
        .filter(
          (ticket) =>
            ticket.calledAt !== null &&
            ticket.status !== TicketStatus.CALLED &&
            ticket.status !== TicketStatus.IN_ROOM &&
            ticket.status !== TicketStatus.WAITING,
        )
        .sort((a, b) => (b.calledAt ?? '').localeCompare(a.calledAt ?? ''))
        .slice(0, HISTORY_LIMIT),
    [allTickets],
  );

  /** Pulse the tile of the most recent call while it is still in CALLED. */
  const highlightedId = useMemo(() => {
    const last = lastCalledId !== null ? tickets[lastCalledId] : undefined;
    if (last !== undefined && last.status === TicketStatus.CALLED) return last.id;
    const newestCalled = active.find((ticket) => ticket.status === TicketStatus.CALLED);
    return newestCalled !== undefined ? newestCalled.id : null;
  }, [lastCalledId, tickets, active]);

  const tileSize: TileSize = active.length <= 2 ? 'xl' : active.length <= 4 ? 'lg' : 'md';
  const gridCols =
    active.length <= 1 ? 'grid-cols-1' : active.length <= 4 ? 'grid-cols-2' : 'grid-cols-3';

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-950 text-white">
      <header className="flex shrink-0 items-center justify-between border-b-2 border-slate-800 px-10 py-5">
        <div className="text-5xl font-black tracking-tight">
          Avi<span className="text-emerald-400">Shifo</span>
        </div>
        <div className="flex items-center gap-10">
          <ConnectionStatus state={connection} />
          <Clock />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col px-10 py-8">
          <h1 className="mb-8 shrink-0 text-4xl font-bold uppercase tracking-widest text-slate-400">
            Hozir qabulda
          </h1>
          {active.length === 0 ? (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-display-sm font-bold text-slate-700">Navbat kutilmoqda…</p>
            </div>
          ) : (
            <div className={`grid flex-1 content-center gap-8 overflow-hidden ${gridCols}`}>
              {active.map((ticket) => (
                <TicketTile
                  key={ticket.id}
                  ticket={ticket}
                  size={tileSize}
                  highlighted={ticket.id === highlightedId}
                />
              ))}
            </div>
          )}
        </main>

        <aside className="w-[26rem] shrink-0 border-l-2 border-slate-800 px-8 py-8">
          <WaitingList tickets={waiting} />
        </aside>
      </div>

      <footer className="flex min-h-[6rem] shrink-0 items-center gap-8 border-t-2 border-slate-800 px-10 py-4">
        <HistoryStrip tickets={history} />
        <NewsTicker />
      </footer>
    </div>
  );
}
