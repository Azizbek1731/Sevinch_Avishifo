'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useApiErrorToast } from '@/features/services/hooks';
import { admissionsApi } from '../api';

const OUTCOMES = ['RECOVERED', 'IMPROVED', 'UNCHANGED', 'WORSE', 'TRANSFERRED', 'DIED'] as const;

/**
 * Closing the stay. The final diagnosis and the outcome are the two entries
 * the 003 title page cannot be filed without, so they are the two the form
 * insists on.
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
  const queryClient = useQueryClient();
  const errorToast = useApiErrorToast();

  const [outcome, setOutcome] = useState<(typeof OUTCOMES)[number]>('RECOVERED');
  const [main, setMain] = useState('');
  const [epicrisis, setEpicrisis] = useState('');

  const discharge = useMutation({
    mutationFn: () =>
      admissionsApi.discharge(admissionId, {
        outcome,
        finalDiagnosisMain: main.trim(),
        epicrisis: epicrisis.trim() || undefined,
      } as never),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admissions'] });
      void queryClient.invalidateQueries({ queryKey: ['admission', admissionId] });
      onOpenChange(false);
      toast.success(t('discharged'));
      onDone();
    },
    onError: errorToast,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('discharge')}</DialogTitle>
          {/* Said up front, because the API refuses and the reason is not
              obvious from a generic error. */}
          <DialogDescription>{t('dischargeHint')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
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
            <Textarea id="d-epi" rows={4} value={epicrisis} onChange={(e) => setEpicrisis(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="destructive"
            className="w-full"
            disabled={!main.trim() || discharge.isPending}
            onClick={() => discharge.mutate()}
          >
            {t('discharge')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
