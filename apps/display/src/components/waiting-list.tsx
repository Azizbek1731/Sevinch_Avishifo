import type { QueueTicketPayload, TicketPriority } from '@avishifo/shared';
import { shortDoctorName } from '@/lib/format';

const PRIORITY_STYLE: Record<TicketPriority, { row: string; num: string; badge: string | null }> = {
  EMERGENCY: {
    row: 'border-red-500/40 bg-red-500/10',
    num: 'text-red-300',
    badge: 'Shoshilinch',
  },
  PRIORITY: {
    row: 'border-amber-400/40 bg-amber-400/10',
    num: 'text-amber-200',
    badge: 'Imtiyozli',
  },
  NORMAL: { row: 'border-white/8 bg-white/[0.03]', num: 'text-white', badge: null },
};

/**
 * The next waiting tickets. How many actually fit depends on the monitor, so the
 * list is clipped by its own box rather than by a fixed count, and whatever did
 * not fit is counted at the bottom — a queue that silently stops at eight reads
 * as "only eight people waiting".
 */
export function WaitingList({
  tickets,
  total,
}: {
  tickets: QueueTicketPayload[];
  /** Everyone waiting, not just the ones handed to this list. */
  total: number;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="mb-6 flex shrink-0 items-center gap-3">
        <span className="h-8 w-1.5 rounded-full bg-brand" />
        <h2 className="text-3xl font-bold uppercase tracking-[0.2em] text-slate-300">Keyingi navbat</h2>
      </div>

      {tickets.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-3xl border border-white/5 bg-white/[0.02]">
          <p className="text-3xl font-medium text-slate-600">Navbat bo&apos;sh</p>
        </div>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-hidden">
          {tickets.map((ticket, index) => {
            const style = PRIORITY_STYLE[ticket.priority];
            return (
              <li
                key={ticket.id}
                className={`animate-enter flex shrink-0 items-center gap-4 rounded-2xl border px-5 py-4 ${style.row}`}
              >
                <span className="w-9 shrink-0 text-center text-2xl font-bold tabular-nums text-slate-600">
                  {index + 1}
                </span>
                <span className={`text-5xl font-black tabular-nums ${style.num}`}>
                  {ticket.ticketNumber}
                </span>
                <div className="ml-auto flex flex-col items-end gap-1 overflow-hidden">
                  {style.badge ? (
                    <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-sm font-semibold uppercase tracking-wide text-slate-200">
                      {style.badge}
                    </span>
                  ) : null}
                  <span className="max-w-[13rem] truncate text-xl text-slate-400">
                    {shortDoctorName(ticket.doctorName)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {total > tickets.length ? (
        <p className="mt-4 shrink-0 text-center text-xl font-semibold text-slate-500">
          +{total - tickets.length} kishi kutmoqda
        </p>
      ) : null}
    </div>
  );
}
