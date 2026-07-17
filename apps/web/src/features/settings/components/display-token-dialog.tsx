'use client';

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Check, Copy, MonitorPlay } from 'lucide-react';
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

const DISPLAY_BASE_URL = process.env.NEXT_PUBLIC_DISPLAY_URL ?? 'http://localhost:3002';

export interface DisplayTokenDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branch: BranchRow | null;
}

export function DisplayTokenDialog({ open, onOpenChange, branch }: DisplayTokenDialogProps) {
  const t = useTranslations('settings');
  const errorToast = useApiErrorToast();
  const [copied, setCopied] = useState<'token' | 'url' | null>(null);

  const mutation = useMutation({
    mutationFn: (branchId: string) => settingsApi.createDisplayToken(branchId),
    onError: errorToast,
  });

  const token = mutation.data?.data.token;
  const displayUrl = token ? `${DISPLAY_BASE_URL}/?token=${token}` : null;

  const branchId = branch?.id ?? null;
  useEffect(() => {
    if (!open || !branchId) return;
    setCopied(null);
    mutation.reset();
    mutation.mutate(branchId);
  }, [open, branchId]);

  const copy = async (value: string, what: 'token' | 'url') => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      toast.success(t('display.copied'));
    } catch {
      toast.error(t('display.copyFailed'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MonitorPlay className="h-5 w-5" />
            {t('display.title', { branch: branch?.name ?? '' })}
          </DialogTitle>
          <DialogDescription>{t('display.desc')}</DialogDescription>
        </DialogHeader>

        {mutation.isPending ? (
          <div className="space-y-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : token ? (
          <div className="space-y-4">
            <div className="space-y-1">
              <p className="text-sm font-medium">{t('display.tokenLabel')}</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded-md border bg-muted px-3 py-2 font-mono text-xs">
                  {token}
                </code>
                <Button type="button" variant="outline" size="sm" onClick={() => void copy(token, 'token')}>
                  {copied === 'token' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            {displayUrl ? (
              <div className="space-y-1">
                <p className="text-sm font-medium">{t('display.urlLabel')}</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded-md border bg-muted px-3 py-2 font-mono text-xs">
                    {displayUrl}
                  </code>
                  <Button type="button" variant="outline" size="sm" onClick={() => void copy(displayUrl, 'url')}>
                    {copied === 'url' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{t('display.urlHint')}</p>
              </div>
            ) : null}
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
