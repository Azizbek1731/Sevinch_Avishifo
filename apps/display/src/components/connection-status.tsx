import type { ConnectionState } from '@/lib/use-display-socket';

/** Header status pill: live (green) / connecting / disconnected (red). */
export function ConnectionStatus({ state }: { state: ConnectionState }) {
  if (state === 'connected') {
    return (
      <div className="flex items-center gap-2.5 rounded-full bg-emerald-500/10 px-4 py-2 ring-1 ring-emerald-500/30">
        <span className="animate-breathe h-3 w-3 rounded-full bg-emerald-400 shadow-[0_0_10px_2px_rgba(52,211,153,0.7)]" />
        <span className="text-base font-semibold uppercase tracking-widest text-ok">
          Jonli
        </span>
      </div>
    );
  }
  const connecting = state === 'connecting';
  const label = connecting ? 'Ulanmoqda…' : 'Aloqa uzildi';
  const tone = connecting
    ? 'bg-amber-500/10 ring-amber-500/30 text-warn'
    : 'bg-red-500/10 ring-red-500/30 text-bad';
  const dot = connecting ? 'bg-amber-400' : 'bg-red-500';
  return (
    <div className={`flex items-center gap-2.5 rounded-full px-4 py-2 ring-1 ${tone}`}>
      <span className={`animate-soft-blink h-3 w-3 rounded-full ${dot}`} />
      <span className="text-base font-semibold uppercase tracking-widest">{label}</span>
    </div>
  );
}
