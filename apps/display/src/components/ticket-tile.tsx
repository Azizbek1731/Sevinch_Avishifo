import { TicketStatus } from '@avishifo/shared';
import type { QueueTicketPayload } from '@avishifo/shared';
import { roomLabel } from '@/lib/format';

export type TileSize = 'xl' | 'lg' | 'md';

const NUMBER_CLASS: Record<TileSize, string> = {
  xl: 'text-display',
  lg: 'text-display-sm',
  md: 'text-7xl',
};

const ROOM_CLASS: Record<TileSize, string> = {
  xl: 'text-6xl',
  lg: 'text-5xl',
  md: 'text-4xl',
};

const DOCTOR_CLASS: Record<TileSize, string> = {
  xl: 'text-4xl',
  lg: 'text-3xl',
  md: 'text-2xl',
};

/** "Now serving" tile: giant ticket number + room + doctor. */
export function TicketTile({
  ticket,
  size,
  highlighted,
}: {
  ticket: QueueTicketPayload;
  size: TileSize;
  highlighted: boolean;
}) {
  const inRoom = ticket.status === TicketStatus.IN_ROOM;
  const room = roomLabel(ticket.roomNumber);

  const frame = highlighted
    ? 'animate-called-pulse border-emerald-400 bg-emerald-500/10'
    : inRoom
      ? 'border-slate-700 bg-slate-900/60'
      : 'border-slate-600 bg-slate-900';

  return (
    <div
      className={`flex flex-col items-center justify-center gap-5 rounded-3xl border-4 px-8 py-10 text-center ${frame}`}
    >
      <div
        className={`${NUMBER_CLASS[size]} font-black leading-none tabular-nums ${
          highlighted ? 'text-emerald-300' : 'text-white'
        }`}
      >
        {ticket.ticketNumber}
      </div>
      {room !== null ? (
        <div className={`${ROOM_CLASS[size]} font-bold text-amber-300`}>{room}</div>
      ) : null}
      {ticket.doctorName !== null ? (
        <div className={`${DOCTOR_CLASS[size]} font-medium text-slate-300`}>{ticket.doctorName}</div>
      ) : null}
      <div className="text-2xl uppercase tracking-widest text-slate-400">
        {inRoom ? 'Qabulda' : 'Chaqirilmoqda'}
      </div>
    </div>
  );
}
