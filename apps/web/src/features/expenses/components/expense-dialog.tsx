'use client';

import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Wallet } from 'lucide-react';
import { createExpenseSchema, type CreateExpenseInput, type ExpenseMethod } from '@avishifo/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
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
import {
  expensesApi,
  sanitizeMoney,
  todayInTashkent,
  type ExpenseCategoryRow,
  type ExpenseRow,
} from '../api';

const METHODS: ExpenseMethod[] = ['CASH', 'CARD', 'PAYME', 'CLICK', 'UZUM'];

export interface ExpenseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: ExpenseCategoryRow[];
  /** null → create; otherwise edit this row. */
  expense: ExpenseRow | null;
}

export function ExpenseDialog({ open, onOpenChange, categories, expense }: ExpenseDialogProps) {
  const t = useTranslations('expenses');
  const errorToast = useApiErrorToast();
  const queryClient = useQueryClient();
  const isEdit = expense !== null;

  const form = useForm<CreateExpenseInput>({
    resolver: zodResolver(createExpenseSchema),
    defaultValues: { categoryId: '', amount: '', method: 'CASH', date: todayInTashkent(), note: '' },
  });

  useEffect(() => {
    if (!open) return;
    form.reset(
      expense
        ? {
            categoryId: expense.categoryId,
            amount: expense.amount,
            method: expense.method,
            date: expense.date,
            note: expense.note ?? '',
          }
        : { categoryId: '', amount: '', method: 'CASH', date: todayInTashkent(), note: '' },
    );
  }, [open, expense, form]);

  const save = useMutation({
    mutationFn: (values: CreateExpenseInput) =>
      isEdit ? expensesApi.update(expense.id, values) : expensesApi.create(values),
    onSuccess: () => {
      toast.success(isEdit ? t('updated') : t('created'));
      // The drawer total moves with the expense, so the shift panel has to
      // re-read too — otherwise the cashier sees a figure that is already wrong.
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
      void queryClient.invalidateQueries({ queryKey: ['shift'] });
      onOpenChange(false);
    },
    onError: errorToast,
  });

  const method = form.watch('method');
  const activeCategories = categories.filter((c) => c.isActive || c.id === expense?.categoryId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? t('editTitle') : t('newTitle')}</DialogTitle>
        </DialogHeader>

        <form
          onSubmit={form.handleSubmit((v) => save.mutate(v))}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="expense-amount">{t('amount')}</Label>
            <Input
              id="expense-amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              {...form.register('amount', { setValueAs: sanitizeMoney })}
            />
            {form.formState.errors.amount ? (
              <p className="text-xs text-destructive">{t('amountInvalid')}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label>{t('category')}</Label>
            <Select
              value={form.watch('categoryId')}
              onValueChange={(v) => form.setValue('categoryId', v, { shouldValidate: true })}
            >
              <SelectTrigger>
                <SelectValue placeholder={t('categoryPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {activeCategories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {activeCategories.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('noCategoriesHint')}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label>{t('method')}</Label>
            <Select
              value={method}
              disabled={isEdit}
              onValueChange={(v) => form.setValue('method', v as ExpenseMethod)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {t(`methods.${m}` as never)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isEdit ? (
              <p className="text-xs text-muted-foreground">{t('methodLocked')}</p>
            ) : method === 'CASH' ? (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Wallet className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {t('cashHint')}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="expense-date">{t('date')}</Label>
            <Input id="expense-date" type="date" {...form.register('date')} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="expense-note">{t('note')}</Label>
            <Textarea
              id="expense-note"
              rows={2}
              placeholder={t('notePlaceholder')}
              {...form.register('note')}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? t('saving') : t('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
