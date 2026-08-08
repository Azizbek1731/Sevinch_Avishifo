import { TicketStatus } from '@avishifo/shared';
import type { QueueTicketPayload } from '@avishifo/shared';
import { roomLabel } from '@/lib/format';

/**
 * How dense the board is. It no longer picks a font size — the tile's own
 * container query does that from the space it was actually given — but it still
 * decides how much padding is affordable and whether the status pill earns its
 * vertical space.
 */
export type TileSize = 'hero' | 'xl' | 'lg' | 'md' | 'sm';

const PAD: Record<TileSize, string> = {
  hero: 'px-[4%] py-[4%] gap-[3%]',
  xl: 'px-[4%] py-[4%] gap-[3%]',
  lg: 'px-[4%] py-[3.5%] gap-[2.5%]',
  md: 'px-[3.5%] py-[3%] gap-[2%]',
  sm: 'px-[3%] py-[2.5%] gap-[1.5%]',
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
      className={`tile animate-enter flex flex-col items-center justify-center overflow-hidden rounded-[2rem] border-2 text-center shadow-2xl backdrop-blur-sm ${PAD[size]} ${frame}`}
    >
      {/* status pill (hidden on the compact tier to save vertical space) */}
      {size !== 'sm' ? (
        <div
          className={`tile-pill flex shrink-0 items-center gap-[0.5em] rounded-full px-[1em] py-[0.35em] font-bold uppercase tracking-[0.2em] ${
            highlighted
              ? 'bg-emerald-400/15 text-emerald-300'
              : inRoom
                ? 'bg-sky-400/10 text-sky-300'
                : 'bg-white/5 text-slate-400'
          }`}
        >
          {highlighted ? (
            <span className="animate-breathe h-[0.6em] w-[0.6em] rounded-full bg-emerald-300" />
          ) : null}
          {inRoom ? 'Qabulda' : 'Chaqirilmoqda'}
        </div>
      ) : null}

      <div
        className={`tile-number font-black tabular-nums ${
          highlighted ? 'text-white drop-shadow-[0_0_25px_rgba(52,211,153,0.45)]' : 'text-white'
        }`}
      >
        {ticket.ticketNumber}
      </div>

      {room !== null ? (
        <div className="tile-room flex shrink-0 items-center gap-[0.35em] font-black text-amber-300">
          <span className="animate-nudge text-amber-400">→</span>
          {room}
        </div>
      ) : null}

      {ticket.doctorName !== null ? (
        <div className="tile-doctor w-full truncate font-medium text-slate-300">{ticket.doctorName}</div>
      ) : null}
    </div>
  );
}
