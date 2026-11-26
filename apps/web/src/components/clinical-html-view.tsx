'use client';

import { cn } from '@/lib/utils';
import { sanitizeClinicalHtml } from '@/lib/clinical-html';

/** Read-only clinical HTML (sanitized). */
export function ClinicalHtmlView({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const html = sanitizeClinicalHtml(value || '');
  return (
    <div
      className={cn(
        'max-w-none break-words text-sm leading-relaxed',
        '[&_p]:my-2 [&_h2]:my-3 [&_h2]:text-lg [&_h2]:font-semibold',
        '[&_h3]:my-2 [&_h3]:text-base [&_h3]:font-semibold',
        '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5',
        '[&_li]:my-0.5 [&_strong]:font-semibold [&_u]:underline',
        className,
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
