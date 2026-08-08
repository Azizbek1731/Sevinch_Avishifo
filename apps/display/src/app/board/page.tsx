'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TicketStatus } from '@avishifo/shared';
import type { QueueTicketPayload, TicketPriority } from '@avishifo/shared';
import { BrandMark } from '@/components/brand-mark';
import { Clock } from '@/components/clock';
import { ConnectionStatus } from '@/components/connection-status';
import { HistoryStrip } from '@/components/history-strip';
import { NewsTicker } from '@/components/ticker';
import { SettingsOverlay } from '@/components/settings-overlay';
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

const WAITING_LIMIT = 10;
const HISTORY_LIMIT = 5;
/**
 * Beyond this the numbers stop being readable from the far side of a waiting
 * room, which is the only thing this screen is for. The rest are counted off to
 * the side rather than shrunk into illegibility.
 */
const ACTIVE_LIMIT = 12;

export default function BoardPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

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

  // Keyboard: S or Escape opens/closes the settings overlay (TV remotes too).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 's' || e.key === 'S') setSettingsOpen((v) => !v);
      else if (e.key === 'Escape') setSettingsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const changeToken = useCallback(() => {
    clearDisplayToken();
    router.replace('/');
  }, [router]);

  const allTickets = useMemo(() => Object.values(tickets), [tickets]);

  const active = useMemo(
    () =>
      allTickets
        .filter(
          (t) => t.status === TicketStatus.CALLED || t.status === TicketStatus.IN_ROOM,
        )
        .sort((a, b) => (b.calledAt ?? b.createdAt).localeCompare(a.calledAt ?? a.createdAt)),
    [allTickets],
  );

  const waitingTotal = useMemo(
    () => allTickets.filter((t) => t.status === TicketStatus.WAITING).length,
    [allTickets],
  );

  const waiting = useMemo(
    () =>
      allTickets
        .filter((t) => t.status === TicketStatus.WAITING)
        .sort(
          (a, b) =>
            PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
            a.position - b.position ||
            a.createdAt.localeCompare(b.createdAt),
        )
        .slice(0, WAITING_LIMIT),
    [allTickets],
  );

  const history = useMemo(
    () =>
      allTickets
        .filter(
          (t) =>
            t.calledAt !== null &&
            t.status !== TicketStatus.CALLED &&
            t.status !== TicketStatus.IN_ROOM &&
            t.status !== TicketStatus.WAITING,
        )
        .sort((a, b) => (b.calledAt ?? '').localeCompare(a.calledAt ?? ''))
        .slice(0, HISTORY_LIMIT),
    [allTickets],
  );

  const highlightedId = useMemo(() => {
    const last = lastCalledId !== null ? tickets[lastCalledId] : undefined;
    if (last !== undefined && last.status === TicketStatus.CALLED) return last.id;
    const newestCalled = active.find((t) => t.status === TicketStatus.CALLED);
    return newestCalled !== undefined ? newestCalled.id : null;
  }, [lastCalledId, tickets, active]);

  const shown = active.slice(0, ACTIVE_LIMIT);
  const overflowCount = active.length - shown.length;
  const count = shown.length;
  const tileSize: TileSize =
    count === 1 ? 'hero' : count === 2 ? 'xl' : count <= 4 ? 'lg' : count <= 6 ? 'md' : 'sm';
  // Columns are picked so that columns x rows always covers the count. Every row
  // is 1fr, so the grid divides the available height between them and no tile is
  // ever pushed out of sight — which on a queue board would mean a patient being
  // called with nothing on screen to tell them.
  const gridCols =
    count <= 1
      ? 'grid-cols-1'
      : count <= 4
        ? 'grid-cols-2'
        : count <= 9
          ? 'grid-cols-3'
          : 'grid-cols-4';

  const tokenHint = token !== null ? `…${token.slice(-6)}` : null;

  return (
    <div className="relative flex h-screen flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between px-12 py-6">
        <BrandMark subtitle="Navbat monitori" />
        <div className="flex items-center gap-8">
          <ConnectionStatus state={connection} />
          <Clock />
          <button
            type="button"
            aria-label="Sozlamalar"
            onClick={() => setSettingsOpen(true)}
            className="flex h-12 w-12 items-center justify-center rounded-xl text-2xl text-slate-600 transition-colors hover:bg-white/5 hover:text-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            ⚙
          </button>
        </div>
      </header>

      <div className="mx-12 h-px shrink-0 bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      <div className="flex min-h-0 flex-1 gap-8 px-12 py-8 portrait:flex-col">
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="mb-7 flex shrink-0 items-center gap-4">
            <span className="animate-breathe h-4 w-4 rounded-full bg-emerald-400 shadow-[0_0_12px_2px_rgba(52,211,153,0.7)]" />
            <h1 className="text-4xl font-bold uppercase tracking-[0.2em] text-slate-200">
              Hozir qabulda
            </h1>
          </div>
          {count === 0 ? (
            <div className="flex flex-1 items-center justify-center rounded-[2rem] border border-white/5 bg-white/[0.02]">
              <p className="text-display-sm font-black text-slate-700">Navbat kutilmoqda…</p>
            </div>
          ) : (
            <div
              className={`tile-grid grid min-h-0 flex-1 auto-rows-fr gap-7 overflow-hidden ${gridCols}`}
            >
              {shown.map((ticket) => (
                <TicketTile
                  key={ticket.id}
                  ticket={ticket}
                  size={tileSize}
                  highlighted={ticket.id === highlightedId}
                />
              ))}
            </div>
          )}
          {overflowCount > 0 ? (
            <p className="mt-4 shrink-0 text-center text-2xl font-semibold text-slate-500">
              +{overflowCount} ta yana chaqirilmoqda
            </p>
          ) : null}
        </main>

        <aside className="min-h-0 w-[27rem] shrink-0 rounded-[2rem] border border-white/5 bg-white/[0.015] px-8 py-7 portrait:h-[38%] portrait:w-full">
          <WaitingList tickets={waiting} total={waitingTotal} />
        </aside>
      </div>

      <footer className="flex min-h-[5.5rem] shrink-0 items-center gap-8 border-t border-white/5 px-12 py-4">
        <HistoryStrip tickets={history} />
        <div className="flex min-w-0 flex-1 items-center">
          <NewsTicker />
        </div>
        <span className="shrink-0 text-lg font-semibold uppercase tracking-[0.25em] text-slate-700">
          AviShifo · Jonli navbat
        </span>
      </footer>

      <SettingsOverlay
        open={settingsOpen}
        connection={connection}
        tokenHint={tokenHint}
        onClose={() => setSettingsOpen(false)}
        onChangeToken={changeToken}
      />
    </div>
  );
}
