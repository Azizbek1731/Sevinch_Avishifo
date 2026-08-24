import type { ReactNode } from 'react';

interface SectionCardProps {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function SectionCard({ title, action, children, className = '' }: SectionCardProps) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-surface p-4 shadow-sm ${className}`}>
      {(title !== undefined || action !== undefined) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title !== undefined && <h2 className="text-base font-semibold text-slate-900">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
