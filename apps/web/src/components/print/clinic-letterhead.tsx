'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ClinicLogo } from './clinic-logo';

export interface ClinicPrintIdentity {
  name: string;
  legalName?: string | null;
  logoUrl?: string | null;
  address?: string | null;
  phone?: string | null;
}

export function formatClinicPhone(phone: string | null | undefined): string {
  const digits = phone?.replace(/\D/g, '') ?? '';
  if (/^998\d{9}$/.test(digits)) {
    return `+998 ${digits.slice(3, 5)} ${digits.slice(5, 8)} ${digits.slice(8, 10)} ${digits.slice(10)}`;
  }
  return phone?.trim() ?? '';
}

/** Give the logo time to decode without making a broken upload block printing. */
export function useClinicPrintAssets(logoUrl: string | null | undefined) {
  const key = logoUrl ?? '';
  const [readyKey, setReadyKey] = useState('');
  const onReady = useCallback(() => setReadyKey(key), [key]);
  useEffect(() => {
    if (!key) return;
    const timer = window.setTimeout(onReady, 3_000);
    return () => window.clearTimeout(timer);
  }, [key, onReady]);
  return { ready: !key || readyKey === key, onReady };
}

/** A first-page letterhead; normal flow prevents overlap on multipage reports. */
export function ClinicLetterhead({
  clinic,
  eyebrow,
  documentLabel,
  onLogoReady,
}: {
  clinic: ClinicPrintIdentity;
  eyebrow?: string;
  documentLabel?: ReactNode;
  onLogoReady?: () => void;
}) {
  return (
    <header className="clinic-letterhead mb-5 break-inside-avoid text-[#12264c]">
      <div className="flex items-center justify-between gap-5 pb-3">
        {clinic.logoUrl ? (
          <div className="w-[46mm] shrink-0">
            <ClinicLogo
              src={clinic.logoUrl}
              className="max-h-[22mm] w-full object-contain"
              onReady={onLogoReady}
            />
          </div>
        ) : null}
        <div className="min-w-0 flex-1">
          {eyebrow ? <p className="mb-1 text-[10px] leading-tight text-[#526174]">{eyebrow}</p> : null}
          <p className="text-[17px] font-bold leading-tight">{clinic.name}</p>
          {clinic.legalName && clinic.legalName !== clinic.name ? (
            <p className="mt-1 text-[11px] leading-tight">{clinic.legalName}</p>
          ) : null}
          {clinic.address ? <p className="mt-1.5 text-[11px] leading-snug">{clinic.address}</p> : null}
          {clinic.phone ? (
            <p className="mt-1 text-[13px] font-semibold tracking-wide">{formatClinicPhone(clinic.phone)}</p>
          ) : null}
        </div>
        {documentLabel ? (
          <div className="max-w-[28mm] shrink-0 border border-[#bcc7d7] px-2 py-1.5 text-center text-[10px] leading-tight">
            {documentLabel}
          </div>
        ) : null}
      </div>
      <div aria-hidden className="flex">
        <span className="w-[22%] border-t-[3px] border-[#e41d36]" />
        <span className="flex-1 border-t-[3px] border-[#173f91]" />
      </div>
    </header>
  );
}

/** An end-of-document credit line, never a fixed footer over clinical content. */
export function ClinicDocumentFooter({ clinic: _clinic }: { clinic: ClinicPrintIdentity }) {
  return (
    <div className="mt-6 break-inside-avoid border-t border-[#bcc7d7] pt-2 text-[10px] leading-snug text-[#526174]">
      <span>Made with AviShifo.uz</span>
    </div>
  );
}
