import type { ConnectionState } from '@/lib/use-display-socket';

/** Header dot: green when live, red + "Aloqa uzildi" while reconnecting. */
export function ConnectionStatus({ state }: { state: ConnectionState }) {
  if (state === 'connected') {
    return (
      <div className="flex items-center gap-3" title="Ulangan">
        <span className="h-5 w-5 rounded-full bg-emerald-400" />
      </div>
    );
  }
  const label = state === 'connecting' ? 'Ulanmoqda…' : 'Aloqa uzildi';
  return (
    <div className="flex items-center gap-3">
      <span className="animate-soft-blink h-5 w-5 rounded-full bg-red-500" />
      <span className="text-3xl font-semibold text-red-400">{label}</span>
    </div>
  );
}
