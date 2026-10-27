'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, X } from 'lucide-react';
import { PaymentMethod, formatUZS, fromTiyin, type PaymentPart } from '@avishifo/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { sanitizeMoney } from '../api';
import { inputTiyin, INVOICE_PAYMENT_METHODS, needsOpenShift } from '../payment-methods';

export interface PaymentSplitProps {
  /**
   * Target the parts should add up to.
   * - full settlement: invoice due
   * - partial: the amount the cashier is collecting now
   */
  total: string;
  value: PaymentPart[];
  onChange: (parts: PaymentPart[]) => void;
  /** Warn next to any external account that needs an open shift. */
  cashBlocked?: boolean;
  disabled?: boolean;
  /**
   * Always show amount fields (even for one method) so the cashier can pay
   * less than the outstanding balance and leave the rest as debt.
   */
  allowPartial?: boolean;
}

/** Sum of the parts, in tiyin, so rounding never drifts. */
export function splitTotalTiyin(parts: PaymentPart[]): bigint {
  return parts.reduce((acc, p) => acc + (inputTiyin(sanitizeMoney(p.amount)) ?? 0n), 0n);
}

/**
 * Splits one bill across payment methods — 100 000 by Click and 30 000 in cash
 * against the same 130 000 sale, which is how a front desk actually takes money.
 *
 * A single row is the ordinary case; with `allowPartial` the amount stays editable
 * so a patient can pay what they have now.
 */
export function PaymentSplit({
  total,
  value,
  onChange,
  cashBlocked = false,
  disabled = false,
  allowPartial = false,
}: PaymentSplitProps) {
  const t = useTranslations('billing');
  const noteId = useId();

  const totalTiyin = inputTiyin(total) ?? 0n;
  const paidTiyin = splitTotalTiyin(value);
  const remainingTiyin = totalTiyin - paidTiyin;
  const showAmounts = allowPartial || value.length > 1;

  const setPart = (index: number, patch: Partial<PaymentPart>): void => {
    onChange(value.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  };

  const addPart = (): void => {
    const rest = remainingTiyin > 0n ? fromTiyin(remainingTiyin) : '0';
    const used = new Set(value.map((p) => p.method));
    const nextMethod = INVOICE_PAYMENT_METHODS.find((m) => !used.has(m)) ?? PaymentMethod.CASH;
    if (allowPartial) {
      // Qisman to‘lovda usullar jami — kassir yig‘ayotgan summa; yangi qator 0 dan to‘ldiriladi.
      onChange([...value, { method: nextMethod, amount: '0' }]);
      return;
    }
    const existing = value.length === 1 ? [{ ...value[0]!, amount: fromTiyin(totalTiyin) }] : value;
    onChange([...existing, { method: nextMethod, amount: value.length === 1 ? '0' : rest }]);
  };

  const removePart = (index: number): void => {
    const rest = value.filter((_, i) => i !== index);
    if (rest.length > 0 && !allowPartial) {
      const back = totalTiyin - splitTotalTiyin(rest.slice(1));
      rest[0] = { ...rest[0]!, amount: back > 0n ? fromTiyin(back) : '0' };
    }
    onChange(rest);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>{t('pay.method')}</Label>
        {value.length < INVOICE_PAYMENT_METHODS.length ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={addPart}
            disabled={disabled}
            className="h-8"
          >
            <Plus className="mr-1 h-4 w-4" />
            {t('split.addMethod')}
          </Button>
        ) : null}
      </div>

      <div className="space-y-2">
        {value.map((part, index) => (
          <div key={index} className="space-y-2 rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <Select
                value={part.method}
                onValueChange={(v) => setPart(index, { method: v as PaymentMethod })}
                disabled={disabled}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INVOICE_PAYMENT_METHODS.map((m) => (
                    <SelectItem
                      key={m}
                      value={m}
                      disabled={value.some(
                        (other, otherIndex) => otherIndex !== index && other.method === m,
                      )}
                    >
                      {t(`methods.${m}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {showAmounts ? (
                <>
                  <Input
                    inputMode="decimal"
                    className="w-36 text-right"
                    value={part.amount}
                    onChange={(e) => setPart(index, { amount: sanitizeMoney(e.target.value) })}
                    disabled={disabled}
                    aria-label={t('split.amountFor', { method: t(`methods.${part.method}`) })}
                  />
                  {value.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removePart(index)}
                      disabled={disabled}
                      aria-label={t('split.remove')}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  ) : null}
                </>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${noteId}-${index}`} className="text-xs text-muted-foreground">
                {t('pay.noteOptional')}
              </Label>
              <Textarea
                id={`${noteId}-${index}`}
                rows={2}
                maxLength={500}
                value={part.note ?? ''}
                onChange={(event) => setPart(index, { note: event.target.value })}
                placeholder={t('pay.notePlaceholder')}
                disabled={disabled}
                className="min-h-16 resize-y"
              />
            </div>
          </div>
        ))}
      </div>

      {showAmounts && value.length > 1 && !allowPartial ? (
        <p
          className={`text-sm ${
            remainingTiyin === 0n ? 'text-muted-foreground' : 'font-medium text-destructive'
          }`}
        >
          {remainingTiyin === 0n
            ? t('split.balanced', { total: formatUZS(fromTiyin(totalTiyin)) })
            : remainingTiyin > 0n
              ? t('split.remaining', { amount: formatUZS(fromTiyin(remainingTiyin)) })
              : t('split.over', { amount: formatUZS(fromTiyin(-remainingTiyin)) })}
        </p>
      ) : null}

      {cashBlocked && value.some((p) => needsOpenShift(p.method)) ? (
        <p className="text-sm font-medium text-warning-foreground">{t('quick.shiftRequired')}</p>
      ) : null}
    </div>
  );
}
