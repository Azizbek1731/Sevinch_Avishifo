'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { KeyRound, Loader2, Lock, Settings2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useApiErrorToast } from '@/features/services/hooks';
import { reportsApi } from '../api';

function formatRemaining(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function digitsOnly(value: string, max = 4): string {
  return value.replace(/\D/g, '').slice(0, max);
}

/** Permanent 4-digit PIN unlock before doctor share / pay figures are shown. */
export function DoctorPayGate({ children }: { children: React.ReactNode }) {
  const t = useTranslations('reports.doctorPayGate');
  const errorToast = useApiErrorToast();
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [changeOpen, setChangeOpen] = useState(false);
  const [currentCode, setCurrentCode] = useState('');
  const [newCode, setNewCode] = useState('');
  const [confirmCode, setConfirmCode] = useState('');

  const status = useQuery({
    queryKey: ['reports', 'doctor-pay', 'status'],
    queryFn: () => reportsApi.doctorPayStatus(),
    refetchInterval: (q) => (q.state.data?.unlocked ? 30_000 : false),
  });

  const unlockMinutes = Math.max(
    1,
    Math.round((status.data?.unlockTtlSeconds ?? 30 * 60) / 60),
  );

  const verify = useMutation({
    mutationFn: () => reportsApi.verifyDoctorPayCode({ code: code.trim() }),
    onSuccess: async (res) => {
      setCode('');
      setRemainingSeconds(res.expiresInSeconds);
      await qc.invalidateQueries({ queryKey: ['reports', 'doctor-pay'] });
      await qc.invalidateQueries({ queryKey: ['reports', 'doctor-activity'] });
      await qc.invalidateQueries({ queryKey: ['ambulatory', 'commissions'] });
    },
    onError: errorToast,
  });

  const changePin = useMutation({
    mutationFn: () =>
      reportsApi.changeDoctorPayPin({
        currentCode: currentCode.trim(),
        newCode: newCode.trim(),
      }),
    onSuccess: () => {
      toast.success(t('pinChanged'));
      setChangeOpen(false);
      setCurrentCode('');
      setNewCode('');
      setConfirmCode('');
    },
    onError: errorToast,
  });

  const lock = useMutation({
    mutationFn: () => reportsApi.lockDoctorPay(),
    onSuccess: async () => {
      setRemainingSeconds(null);
      setCode('');
      await qc.invalidateQueries({ queryKey: ['reports', 'doctor-pay'] });
      await qc.invalidateQueries({ queryKey: ['reports', 'doctor-activity'] });
      await qc.invalidateQueries({ queryKey: ['ambulatory', 'commissions'] });
    },
    onError: errorToast,
  });

  useEffect(() => {
    if (status.data?.unlocked && status.data.expiresInSeconds != null) {
      setRemainingSeconds(status.data.expiresInSeconds);
    }
    if (status.data && !status.data.unlocked) setRemainingSeconds(null);
  }, [status.data?.unlocked, status.data?.expiresInSeconds, status.data]);

  useEffect(() => {
    if (!status.data?.unlocked) return;
    const timer = window.setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev == null) return prev;
        if (prev <= 1) {
          void qc.invalidateQueries({ queryKey: ['reports', 'doctor-pay'] });
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [status.data?.unlocked, qc]);

  const changeValid =
    currentCode.length === 4 &&
    newCode.length === 4 &&
    confirmCode.length === 4 &&
    newCode === confirmCode;

  const unlockedBanner = useMemo(() => {
    if (!status.data?.required || !status.data.unlocked) return null;
    return (
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 px-3 py-2">
        <p className="text-sm text-muted-foreground">
          {t('unlockedUntil', {
            time: formatRemaining(remainingSeconds ?? status.data.expiresInSeconds ?? 0),
            minutes: unlockMinutes,
          })}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setChangeOpen(true)}>
            <Settings2 className="mr-2 h-4 w-4" />
            {t('changePin')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={lock.isPending}
            onClick={() => lock.mutate()}
          >
            {lock.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Lock className="mr-2 h-4 w-4" />
            )}
            {t('lock')}
          </Button>
        </div>
      </div>
    );
  }, [status.data, remainingSeconds, unlockMinutes, lock, t]);

  const changeDialog = (
    <Dialog
      open={changeOpen}
      onOpenChange={(open) => {
        setChangeOpen(open);
        if (!open) {
          setCurrentCode('');
          setNewCode('');
          setConfirmCode('');
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('changePinTitle')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pay-pin-current">{t('currentPin')}</Label>
            <Input
              id="pay-pin-current"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              placeholder="••••"
              value={currentCode}
              onChange={(e) => setCurrentCode(digitsOnly(e.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-pin-new">{t('newPin')}</Label>
            <Input
              id="pay-pin-new"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              placeholder="••••"
              value={newCode}
              onChange={(e) => setNewCode(digitsOnly(e.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-pin-confirm">{t('confirmPin')}</Label>
            <Input
              id="pay-pin-confirm"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              placeholder="••••"
              value={confirmCode}
              onChange={(e) => setConfirmCode(digitsOnly(e.target.value))}
            />
            {confirmCode.length === 4 && newCode !== confirmCode ? (
              <p className="text-xs text-destructive">{t('pinMismatch')}</p>
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setChangeOpen(false)}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            disabled={!changeValid || changePin.isPending}
            onClick={() => changePin.mutate()}
          >
            {changePin.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t('savePin')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (status.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        {t('checking')}
      </div>
    );
  }

  if (!status.data?.required || status.data.unlocked) {
    return (
      <>
        {unlockedBanner}
        {children}
        {changeDialog}
      </>
    );
  }

  return (
    <>
      <Card className="mx-auto max-w-lg border-primary/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <KeyRound className="h-5 w-5 text-primary" />
            {t('title')}
          </CardTitle>
          <p className="text-sm text-muted-foreground">{t('hint', { minutes: unlockMinutes })}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="doctor-pay-code">{t('codeLabel')}</Label>
            <Input
              id="doctor-pay-code"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              placeholder="••••"
              value={code}
              onChange={(e) => setCode(digitsOnly(e.target.value))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && code.length === 4) verify.mutate();
              }}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={code.length !== 4 || verify.isPending}
              onClick={() => verify.mutate()}
            >
              {verify.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t('unlock')}
            </Button>
            <Button type="button" variant="outline" onClick={() => setChangeOpen(true)}>
              <Settings2 className="mr-2 h-4 w-4" />
              {t('changePin')}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t('sessionHint', { minutes: unlockMinutes })}</p>
        </CardContent>
      </Card>
      {changeDialog}
    </>
  );
}
