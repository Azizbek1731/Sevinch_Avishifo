import type { QueueTicketPayload } from '@avishifo/shared';
import { roomLabel } from '@/lib/format';

/** Bottom strip: the last few called tickets that already left the main area. */
export function HistoryStrip({ tickets }: { tickets: QueueTicketPayload[] }) {
  if (tickets.length === 0) return null;
  return (
    <div className="flex shrink-0 items-center gap-3">
      <span className="text-base font-semibold uppercase tracking-[0.2em] text-slate-500">
        So&apos;nggi
      </span>
      {tickets.map((ticket) => {
        const room = roomLabel(ticket.roomNumber);
        return (
          <span
            key={ticket.id}
            className="flex items-baseline gap-2 whitespace-nowrap rounded-xl border border-white/5 bg-white/[0.03] px-4 py-2"
          >
            <span className="text-3xl font-bold tabular-nums text-slate-300">
              {ticket.ticketNumber}
            </span>
            {room !== null ? (
              <span className="text-xl font-medium text-slate-500">{room}</span>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}
