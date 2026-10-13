import { describe, expect, it } from 'vitest';
import { addPaymentSchema, addPaymentsSchema, paymentPartSchema } from './billing';

const idempotencyKey = '12345678-1234-4234-a234-123456789abc';

describe('payment notes', () => {
  it('keeps existing payments valid without a note', () => {
    expect(
      addPaymentSchema.parse({ amount: '100', method: 'CASH', idempotencyKey }).note,
    ).toBeUndefined();
  });

  it('trims each note and retains separate notes for a split payment', () => {
    const input = addPaymentsSchema.parse({
      idempotencyKey,
      payments: [
        { amount: '70', method: 'CASH', note: '  Bemor to‘ladi  ' },
        { amount: '30', method: 'CARD', note: 'Terminal № 123' },
      ],
    });
    expect(input.payments.map((part) => part.note)).toEqual(['Bemor to‘ladi', 'Terminal № 123']);
  });

  it('accepts 500 characters and rejects longer notes in both payment endpoints', () => {
    const payment = { amount: '100', method: 'CLICK', note: 'a'.repeat(500) };
    expect(paymentPartSchema.safeParse(payment).success).toBe(true);
    expect(addPaymentSchema.safeParse({ ...payment, idempotencyKey }).success).toBe(true);
    expect(paymentPartSchema.safeParse({ ...payment, note: 'a'.repeat(501) }).success).toBe(false);
    expect(
      addPaymentSchema.safeParse({
        ...payment,
        note: 'a'.repeat(501),
        idempotencyKey,
      }).success,
    ).toBe(false);
  });
});
