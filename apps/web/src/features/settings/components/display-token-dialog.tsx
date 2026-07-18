'use client';

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import QRCode from 'qrcode';
import { Check, ChevronRight, Copy, MonitorPlay } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { settingsApi, type BranchRow } from '../api';
import { useApiErrorToast } from '../hooks';

/**
 * Resolve the TV display base URL (no trailing slash). Priority:
 *  1. `NEXT_PUBLIC_DISPLAY_URL` when set (non-empty).
 *  2. Derived from the panel's own origin in the browser:
 *     - `crm.<domain>`      → `tv.crm.<domain>` (same protocol) — the display subdomain.
 *     - `localhost` / 127.* → same protocol, port 3002 (dev display app).
 *     - otherwise           → the same origin.
 * Returns '' on the server (resolved client-side once the dialog is open).
 */
export function resolveDisplayBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_DISPLAY_URL;
  if (configured && configured.trim() !== '') return configured.trim().replace(/\/+$/, '');

  if (typeof window === 'undefined') return '';

  const { protocol, hostname, origin } = window.location;
  if (hostname === 'localhost' || hostname.startsWith('127.')) {
    return `${protocol}//${hostname}:3002`;
  }
  if (hostname.startsWith('crm.')) {
    return `${protocol}//tv.${hostname}`;
  }
  return origin;
}

export interface DisplayTokenDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branch: BranchRow | null;
}

export function DisplayTokenDialog({ open, onOpenChange, branch }: DisplayTokenDialogProps) {
  const t = useTranslations('settings');
  const errorToast = useApiErrorToast();
  const [copied, setCopied] = useState<'token' | 'url' | null>(null);
  const [displayUrl, setDisplayUrl] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (branchId: string) => settingsApi.createDisplayToken(branchId),
    onError: errorToast,
  });

  const token = mutation.data?.data.token;

  const branchId = branch?.id ?? null;
  useEffect(() => {
    if (!open || !branchId) return;
    setCopied(null);
    setDisplayUrl(null);
    setQrDataUrl(null);
    mutation.reset();
    mutation.mutate(branchId);
  }, [open, branchId]);

  // Resolve the full display URL and render the QR client-side once the token arrives.
  useEffect(() => {
    if (!token) {
      setDisplayUrl(null);
      setQrDataUrl(null);
      return;
    }
    const url = `${resolveDisplayBaseUrl()}/?token=${token}`;
    setDisplayUrl(url);
    let cancelled = false;
    void QRCode.toDataURL(url, { width: 320, margin: 1 })
      .then((dataUrl) => {
        if (!cancelled) setQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const copy = async (value: string, what: 'token' | 'url') => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      toast.success(t('display.copied'));
    } catch {
      toast.error(t('display.copyFailed'));
    }
  };

  const steps = [t('display.steps.s1'), t('display.steps.s2'), t('display.steps.s3')];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MonitorPlay className="h-5 w-5" />
            {t('display.title', { branch: branch?.name ?? '' })}
          </DialogTitle>
          <DialogDescription>{t('display.desc')}</DialogDescription>
        </DialogHeader>

        {mutation.isPending ? (
          <div className="flex flex-col items-center gap-4 py-2">
            <Skeleton className="h-[264px] w-[264px] rounded-xl" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : token ? (
          <div className="min-w-0 space-y-5">
            {/* QR — always dark-on-white so it scans regardless of app theme. */}
            <div className="flex justify-center">
              <div className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-border">
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt={t('display.qrAlt')}
                    width={240}
                    height={240}
                    className="h-60 w-60"
                  />
                ) : (
                  <Skeleton className="h-60 w-60" />
                )}
              </div>
            </div>

            {/* How-to flow */}
            <ol className="space-y-3">
              {steps.map((step, i) => (
                <li key={i} className="flex items-start gap-3 text-sm">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 pt-0.5 text-foreground">{step}</span>
                </li>
              ))}
            </ol>

            {/* Full display URL (fallback to typing it in) */}
            {displayUrl ? (
              <div className="space-y-1.5">
                <p className="text-sm font-medium">{t('display.urlLabel')}</p>
                <div className="flex min-w-0 items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-md border bg-muted px-3 py-2 font-mono text-xs">
                    {displayUrl}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    onClick={() => void copy(displayUrl, 'url')}
                    aria-label={t('display.urlLabel')}
                  >
                    {copied === 'url' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{t('display.urlHint')}</p>
              </div>
            ) : null}

            {/* Raw token — collapsed; staff mostly need the QR/URL. */}
            <details className="group rounded-md border bg-muted/40 px-3 py-2.5">
              <summary className="flex cursor-pointer select-none items-center gap-2 text-sm font-medium text-muted-foreground marker:content-none [&::-webkit-details-marker]:hidden">
                <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" />
                {t('display.showToken')}
              </summary>
              <div className="mt-3 space-y-1.5">
                <div className="flex min-w-0 items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-md border bg-background px-3 py-2 font-mono text-xs">
                    {token}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    onClick={() => void copy(token, 'token')}
                    aria-label={t('display.tokenLabel')}
                  >
                    {copied === 'token' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{t('display.tokenValidity')}</p>
              </div>
            </details>
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('form.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
