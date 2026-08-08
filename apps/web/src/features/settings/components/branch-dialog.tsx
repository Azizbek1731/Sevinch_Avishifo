'use client';

import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { createBranchSchema, type CreateBranchInput,
  phoneWireValueOptional, formatNationalPhone } from '@avishifo/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { PhoneInput } from '@/components/ui/phone-input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  defaultWorkingHours,
  emptyToUndefined,
  parseWorkingHours,
  settingsApi,
  type BranchRow,
} from '../api';
import { useApiErrorToast } from '../hooks';

export interface BranchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null → create; otherwise edit this branch. */
  branch: BranchRow | null;
}


export function BranchDialog({ open, onOpenChange, branch }: BranchDialogProps) {
  const t = useTranslations('settings');
  const errorToast = useApiErrorToast();
  const queryClient = useQueryClient();
  const isEdit = branch !== null;

  const form = useForm<CreateBranchInput>({
    resolver: zodResolver(createBranchSchema),
    defaultValues: { name: '', workingHours: defaultWorkingHours() },
  });
  const hours = useFieldArray({ control: form.control, name: 'workingHours' });

  useEffect(() => {
    if (!open) return;
    if (branch) {
      const parsed = parseWorkingHours(branch.workingHours);
      form.reset({
        name: branch.name,
        address: branch.address ?? undefined,
        phone: branch.phone ? formatNationalPhone(branch.phone) : undefined,
        workingHours: parsed.length > 0 ? parsed : defaultWorkingHours(),
      });
    } else {
      form.reset({ name: '', workingHours: defaultWorkingHours() });
    }
  }, [open, branch]);

  const mutation = useMutation({
    mutationFn: (values: CreateBranchInput) =>
      branch ? settingsApi.updateBranch(branch.id, values) : settingsApi.createBranch(values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['branches'] });
      toast.success(isEdit ? t('branches.updated') : t('branches.created'));
      onOpenChange(false);
    },
    onError: errorToast,
  });

  const workingHours = form.watch('workingHours');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? t('branches.editTitle') : t('branches.createTitle')}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
          noValidate
        >
          <div className="space-y-2">
            <Label htmlFor="branch-name">{t('branches.name')}</Label>
            <Input id="branch-name" autoComplete="off" {...form.register('name')} />
            {form.formState.errors.name ? (
              <p className="text-sm text-destructive">{t('form.required')}</p>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="branch-address">{t('branches.address')}</Label>
              <Input
                id="branch-address"
                autoComplete="off"
                {...form.register('address', { setValueAs: emptyToUndefined })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="branch-phone">{t('branches.phone')}</Label>
              <PhoneInput
                id="branch-phone"
                autoComplete="off"
                {...form.register('phone', { setValueAs: phoneWireValueOptional})}
              />
              {form.formState.errors.phone ? (
                <p className="text-sm text-destructive">{t('form.invalidPhone')}</p>
              ) : null}
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t('branches.workingHours')}</Label>
            <div className="space-y-2 rounded-md border p-3">
              {hours.fields.map((field, index) => {
                const closed = workingHours?.[index]?.closed === true;
                return (
                  <div key={field.id} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 text-sm">
                      {t(`branches.weekdays.w${field.weekday}` as never)}
                    </span>
                    <Input
                      type="time"
                      className="w-28"
                      disabled={closed}
                      {...form.register(`workingHours.${index}.open`)}
                    />
                    <span className="text-muted-foreground">—</span>
                    <Input
                      type="time"
                      className="w-28"
                      disabled={closed}
                      {...form.register(`workingHours.${index}.close`)}
                    />
                    <div className="ml-auto flex items-center gap-2">
                      <Switch
                        checked={closed}
                        onCheckedChange={(v) =>
                          form.setValue(`workingHours.${index}.closed`, v, { shouldDirty: true })
                        }
                      />
                      <span className="text-sm text-muted-foreground">{t('branches.closed')}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            {form.formState.errors.workingHours ? (
              <p className="text-sm text-destructive">{t('branches.invalidHours')}</p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
            >
              {t('form.cancel')}
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {t('form.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
