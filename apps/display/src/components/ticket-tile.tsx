import { TicketStatus } from '@avishifo/shared';
import type { QueueTicketPayload } from '@avishifo/shared';
import { roomLabel } from '@/lib/format';

export type TileSize = 'hero' | 'xl' | 'lg' | 'md' | 'sm';

const NUMBER_CLASS: Record<TileSize, string> = {
  hero: 'text-hero',
  xl: 'text-display',
  lg: 'text-display-sm',
  md: 'text-8xl',
  sm: 'text-6xl',
};
const ROOM_CLASS: Record<TileSize, string> = {
  hero: 'text-7xl',
  xl: 'text-6xl',
  lg: 'text-5xl',
  md: 'text-4xl',
  sm: 'text-3xl',
};
const DOCTOR_CLASS: Record<TileSize, string> = {
  hero: 'text-4xl',
  xl: 'text-4xl',
  lg: 'text-3xl',
  md: 'text-2xl',
  sm: 'text-xl',
};
const PAD: Record<TileSize, string> = {
  hero: 'px-14 py-12 gap-6',
  xl: 'px-10 py-10 gap-5',
  lg: 'px-8 py-8 gap-4',
  md: 'px-6 py-6 gap-3',
  sm: 'px-5 py-4 gap-2',
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
    ? 'animate-called-pulse border-emerald-400/70 bg-gradient-to-b from-emerald-500/15 to-emerald-500/[0.04]'
    : inRoom
      ? 'border-sky-400/25 bg-gradient-to-b from-sky-500/[0.06] to-white/[0.02]'
      : 'border-white/10 bg-white/[0.03]';

  return (
    <div
      className={`animate-enter flex flex-col items-center justify-center rounded-[2rem] border-2 text-center shadow-2xl backdrop-blur-sm ${PAD[size]} ${frame}`}
    >
      {/* status pill (hidden on the compact tier to save vertical space) */}
      {size !== 'sm' ? (
        <div
          className={`flex items-center gap-2.5 rounded-full px-4 py-1.5 text-lg font-bold uppercase tracking-[0.2em] ${
            highlighted
              ? 'bg-emerald-400/15 text-emerald-300'
              : inRoom
                ? 'bg-sky-400/10 text-sky-300'
                : 'bg-white/5 text-slate-400'
          }`}
        >
          {highlighted ? (
            <span className="animate-breathe h-2.5 w-2.5 rounded-full bg-emerald-300" />
          ) : null}
          {inRoom ? 'Qabulda' : 'Chaqirilmoqda'}
        </div>
      ) : null}

      <div
        className={`${NUMBER_CLASS[size]} font-black leading-none tabular-nums ${
          highlighted ? 'text-white drop-shadow-[0_0_25px_rgba(52,211,153,0.45)]' : 'text-white'
        }`}
      >
        {ticket.ticketNumber}
      </div>

      {room !== null ? (
        <div className={`${ROOM_CLASS[size]} flex items-center gap-3 font-black text-amber-300`}>
          <span className="animate-nudge text-amber-400">→</span>
          {room}
        </div>
      ) : null}

      {ticket.doctorName !== null ? (
        <div className={`${DOCTOR_CLASS[size]} font-medium text-slate-300`}>{ticket.doctorName}</div>
      ) : null}
    </div>
  );
}
