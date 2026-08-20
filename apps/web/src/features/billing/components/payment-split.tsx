'use client';

import { useTranslations } from 'next-intl';
import { Plus, X } from 'lucide-react';
import { PaymentMethod, formatUZS, fromTiyin, toTiyin, type PaymentPart } from '@avishifo/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { sanitizeMoney } from '../api';

export interface PaymentSplitProps {
  /** What the parts must add up to — the invoice total, or its outstanding due. */
  total: string;
  value: PaymentPart[];
  onChange: (parts: PaymentPart[]) => void;
  /** Cash needs an open drawer; the warning belongs next to the method that needs it. */
  cashBlocked?: boolean;
  disabled?: boolean;
}

/** Sum of the parts, in tiyin, so rounding never drifts. */
export function splitTotalTiyin(parts: PaymentPart[]): bigint {
  return parts.reduce((acc, p) => acc + (toTiyin(sanitizeMoney(p.amount) || '0') || 0n), 0n);
}

/**
 * Splits one bill across payment methods — 100 000 by Click and 30 000 in cash
 * against the same 130 000 sale, which is how a front desk actually takes money.
 *
 * A single row is the ordinary case and looks exactly like the old single-method
 * picker; the split only appears when someone asks for it.
 */
export function PaymentSplit({
  total,
  value,
  onChange,
  cashBlocked = false,
  disabled = false,
}: PaymentSplitProps) {
  const t = useTranslations('billing');

  const totalTiyin = toTiyin(total || '0');
  const paidTiyin = splitTotalTiyin(value);
  const remainingTiyin = totalTiyin - paidTiyin;

  const setPart = (index: number, patch: Partial<PaymentPart>): void => {
    onChange(value.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  };

  const addPart = (): void => {
    // The new row picks up whatever is still unpaid, which is almost always
    // what the cashier is about to type anyway.
    const rest = remainingTiyin > 0n ? fromTiyin(remainingTiyin) : '0';
    const used = new Set(value.map((p) => p.method));
    const nextMethod =
      Object.values(PaymentMethod).find((m) => !used.has(m)) ?? PaymentMethod.CASH;
    onChange([...value, { method: nextMethod, amount: rest }]);
  };

  const removePart = (index: number): void => {
    const rest = value.filter((_, i) => i !== index);
    // Removing a row hands its amount back to the first one, so the split stays
    // balanced instead of silently going short.
    if (rest.length > 0) {
      const back = totalTiyin - splitTotalTiyin(rest.slice(1));
      rest[0] = { ...rest[0]!, amount: back > 0n ? fromTiyin(back) : '0' };
    }
    onChange(rest);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>{t('pay.method')}</Label>
        {value.length < 6 ? (
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
          <div key={index} className="flex items-center gap-2">
            <Select
              value={part.method}
              onValueChange={(v) => setPart(index, { method: v as PaymentMethod })}
              disabled={disabled}
            >
              <SelectTrigger className="flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(PaymentMethod).map((m) => (
                  <SelectItem key={m} value={m}>
                    {t(`methods.${m}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* One row means one method for the whole bill — no amount to edit. */}
            {value.length > 1 ? (
              <>
                <Input
                  inputMode="decimal"
                  className="w-36 text-right"
                  value={part.amount}
                  onChange={(e) => setPart(index, { amount: sanitizeMoney(e.target.value) })}
                  disabled={disabled}
                  aria-label={t('split.amountFor', { method: t(`methods.${part.method}`) })}
                />
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
              </>
            ) : null}
          </div>
        ))}
      </div>

      {value.length > 1 ? (
        <p
          className={`text-sm ${
            remainingTiyin === 0n
              ? 'text-muted-foreground'
              : 'font-medium text-destructive'
          }`}
        >
          {remainingTiyin === 0n
            ? t('split.balanced', { total: formatUZS(total) })
            : remainingTiyin > 0n
              ? t('split.remaining', { amount: formatUZS(fromTiyin(remainingTiyin)) })
              : t('split.over', { amount: formatUZS(fromTiyin(-remainingTiyin)) })}
        </p>
      ) : null}

      {cashBlocked && value.some((p) => p.method === PaymentMethod.CASH) ? (
        <p className="text-sm font-medium text-warning-foreground">{t('quick.shiftRequired')}</p>
      ) : null}
    </div>
  );
}
