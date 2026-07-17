import type { QueueTicketPayload, TicketPriority } from '@avishifo/shared';
import { shortDoctorName } from '@/lib/format';

const PRIORITY_COLOR: Record<TicketPriority, string> = {
  EMERGENCY: 'text-red-400',
  PRIORITY: 'text-amber-300',
  NORMAL: 'text-white',
};

/** Right column: the next waiting tickets (number + doctor short name). */
export function WaitingList({ tickets }: { tickets: QueueTicketPayload[] }) {
  return (
    <div className="flex h-full flex-col">
      <h2 className="mb-6 text-4xl font-bold uppercase tracking-widest text-slate-400">Navbatda</h2>
      {tickets.length === 0 ? (
        <p className="text-3xl text-slate-600">Navbat bo&apos;sh</p>
      ) : (
        <ul className="flex flex-col gap-4 overflow-hidden">
          {tickets.map((ticket) => (
            <li
              key={ticket.id}
              className="flex items-baseline justify-between rounded-2xl bg-slate-900 px-6 py-4"
            >
              <span
                className={`text-5xl font-extrabold tabular-nums ${PRIORITY_COLOR[ticket.priority]}`}
              >
                {ticket.ticketNumber}
              </span>
              <span className="ml-4 truncate text-2xl text-slate-400">
                {shortDoctorName(ticket.doctorName)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
