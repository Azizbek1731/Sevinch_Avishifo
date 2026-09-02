'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AlertTriangle, ArrowRight, FileText, Loader2, Wallet } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { usePermissions } from '@/hooks/use-permissions';
import { useApiErrorToast } from '@/features/services/hooks';
import { formatUZS } from '@avishifo/shared';
import { admissionsApi, chargesApi, chargeTitle } from '../api';

const OUTCOMES = ['RECOVERED', 'IMPROVED', 'UNCHANGED', 'WORSE', 'TRANSFERRED', 'DIED'] as const;

/**
 * Closing the stay, in the order the money actually has to be settled: bill
 * what was given, take what is owed, then file the history. Each blocker is
 * shown with the button that clears it, so nobody is sent away from the dialog
 * to hunt for a screen — the reason discharge felt like a button that did
 * nothing was that the API's refusal never reached the person pressing it.
 */
export function DischargeDialog({
  open,
  onOpenChange,
  admissionId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  admissionId: string;
  onDone: () => void;
}) {
  const t = useTranslations('admissions');
  const locale = useLocale();
  const can = usePermissions();
  const queryClient = useQueryClient();
  const errorToast = useApiErrorToast();

  const [outcome, setOutcome] = useState<(typeof OUTCOMES)[number]>('RECOVERED');
  const [main, setMain] = useState('');
  const [epicrisis, setEpicrisis] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);

  const check = useQuery({
    queryKey: ['admission-discharge-check', admissionId],
    queryFn: async () => (await admissionsApi.dischargeCheck(admissionId)).data,
    enabled: open,
    staleTime: 0,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['admission-discharge-check', admissionId] });
    void queryClient.invalidateQueries({ queryKey: ['charges'] });
    void queryClient.invalidateQueries({ queryKey: ['invoices'] });
  };

  const raiseInvoice = useMutation({
    mutationFn: () => chargesApi.invoice((check.data?.unbilled.items ?? []).map((i) => i.id)),
    onSuccess: (res) => {
      toast.success(t('invoiceRaised', { number: res.data.number }));
      refresh();
    },
    onError: errorToast,
  });

  const discharge = useMutation({
    mutationFn: () =>
      admissionsApi.discharge(admissionId, {
        outcome,
        finalDiagnosisMain: main.trim(),
        epicrisis: epicrisis.trim() || undefined,
        ...(acknowledged ? { force: true } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admissions'] });
      void queryClient.invalidateQueries({ queryKey: ['admission', admissionId] });
      onOpenChange(false);
      toast.success(t('discharged'));
      onDone();
    },
    onError: (err) => {
      // The stay's money moved under us (a payment voided, a charge added).
      // Re-read so the dialog shows the new blocker instead of the old form.
      refresh();
      errorToast(err);
    },
  });

  const c = check.data;
  const hasUnbilled = (c?.unbilled.count ?? 0) > 0;
  const debt = Number(c?.stayDebt ?? '0');
  const hasDebt = debt > 0;
  const canForce = can('admissions.force');
  const blocked = hasUnbilled || hasDebt;
  // Settled, or being closed over on purpose by someone allowed to do that.
  const moneyCleared = !blocked || (acknowledged && canForce);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('discharge')}</DialogTitle>
          <DialogDescription>{t('dischargeHint')}</DialogDescription>
        </DialogHeader>

        {check.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="space-y-4">
            {/* ---- blocker 1: services not yet on a bill ---- */}
            {hasUnbilled ? (
              <div className="rounded-lg border border-warning/40 bg-warning/10 p-3">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <FileText className="h-4 w-4" />
                  {t('dischargeCheck.unbilled', {
                    count: c?.unbilled.count ?? 0,
                    total: formatUZS(c?.unbilled.total ?? '0'),
                  })}
                </p>
                <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                  {(c?.unbilled.items ?? []).slice(0, 5).map((i) => (
                    <li key={i.id}>
                      {chargeTitle(i.title, locale)} × {i.quantity} — {formatUZS(i.unitPrice)}
                    </li>
                  ))}
                </ul>
                <Button
                  size="sm"
                  className="mt-3 w-full"
                  disabled={raiseInvoice.isPending}
                  onClick={() => raiseInvoice.mutate()}
                >
                  {raiseInvoice.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  {t('dischargeCheck.issueInvoice')}
                </Button>
              </div>
            ) : null}

            {/* ---- blocker 2: this stay still owes money ---- */}
            {hasDebt ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <Wallet className="h-4 w-4" />
                  {t('dischargeCheck.debtTitle')}: {formatUZS(c?.stayDebt ?? '0')}
                </p>
                <ul className="mt-2 space-y-1 text-xs">
                  {(c?.stayInvoices ?? []).map((inv) => (
                    <li key={inv.id} className="flex items-center justify-between gap-2">
                      <span className="font-mono">{inv.number}</span>
                      <span className="text-muted-foreground">{formatUZS(inv.due)}</span>
                      {can('invoices.read') ? (
                        <Link
                          href={`/invoices/${inv.id}`}
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          {t('dischargeCheck.pay')}
                          <ArrowRight className="h-3 w-3" />
                        </Link>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {Number(c?.deposit ?? '0') > 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t('dischargeCheck.deposit')}: {formatUZS(c?.deposit ?? '0')}
                  </p>
                ) : null}
              </div>
            ) : null}

            {/* The way out of any blocker. A bed is physical and the paperwork
                is not — a death, a transfer or a patient who simply left cannot
                wait for the desk to catch up. Nothing is forgiven: the services
                stay billable and the amount is written onto the history. */}
            {blocked ? (
              canForce ? (
                <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-dashed p-3 text-xs">
                  <Checkbox
                    checked={acknowledged}
                    onCheckedChange={(v) => setAcknowledged(v === true)}
                    className="mt-0.5"
                  />
                  <span>{t('dischargeCheck.acknowledge')}</span>
                </label>
              ) : (
                <p className="flex items-start gap-2 text-xs text-muted-foreground">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {t('dischargeCheck.needsForce')}
                </p>
              )
            ) : null}

            {/* Other debt is shown, never enforced — an unrelated old invoice
                must not be what keeps a bed occupied. */}
            {Number(c?.otherDebt ?? '0') > 0 ? (
              <p className="text-xs text-muted-foreground">
                {t('dischargeCheck.otherDebt')}: {formatUZS(c?.otherDebt ?? '0')}
              </p>
            ) : null}

            {/* ---- the history itself ---- */}
            <div className="space-y-1.5">
              <Label htmlFor="d-main">{t('fields.finalDiagnosisMain')} *</Label>
              <Input id="d-main" value={main} onChange={(e) => setMain(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('fields.outcome')}</Label>
              <Select value={outcome} onValueChange={(v) => setOutcome(v as typeof outcome)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OUTCOMES.map((o) => (
                    <SelectItem key={o} value={o}>
                      {t(`outcomes.${o}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="d-epi">{t('fields.epicrisis')}</Label>
              <Textarea
                id="d-epi"
                rows={4}
                value={epicrisis}
                onChange={(e) => setEpicrisis(e.target.value)}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="destructive"
            className="w-full"
            disabled={!main.trim() || !moneyCleared || discharge.isPending || check.isLoading}
            onClick={() => discharge.mutate()}
          >
            {discharge.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t('discharge')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
