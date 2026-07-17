import type { QueueTicketPayload } from '@avishifo/shared';
import { roomLabel } from '@/lib/format';

/** Bottom strip: the last few called tickets that already left the main area. */
export function HistoryStrip({ tickets }: { tickets: QueueTicketPayload[] }) {
  if (tickets.length === 0) return null;
  return (
    <div className="flex shrink-0 items-center gap-4">
      <span className="text-2xl uppercase tracking-widest text-slate-500">Chaqirilgan</span>
      {tickets.map((ticket) => {
        const room = roomLabel(ticket.roomNumber);
        return (
          <span
            key={ticket.id}
            className="whitespace-nowrap rounded-xl bg-slate-900 px-4 py-2 text-3xl font-bold tabular-nums text-slate-300"
          >
            {ticket.ticketNumber}
            {room !== null ? (
              <span className="ml-3 text-2xl font-medium text-slate-500">{room}</span>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}
