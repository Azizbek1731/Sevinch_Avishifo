import { afterEach, describe, expect, it, vi } from 'vitest';
import { scheduleReceiptPrint } from './receipt-print';

describe('receipt print lifecycle', () => {
  afterEach(() => vi.useRealTimers());

  it('still prints when an effect is cleaned up before the receipt paints', () => {
    vi.useFakeTimers();
    const print = vi.fn();
    const options = {
      requestId: 'payment-1',
      attempted: new Set<string>(),
      print,
      onError: vi.fn(),
    };
    const cleanup = scheduleReceiptPrint(options);
    cleanup();
    scheduleReceiptPrint(options);
    vi.runAllTimers();
    expect(print).toHaveBeenCalledTimes(1);
  });

  it('does not print the same successful submission again after a refetch', () => {
    vi.useFakeTimers();
    const print = vi.fn();
    const options = {
      requestId: 'payment-1',
      attempted: new Set<string>(),
      print,
      onError: vi.fn(),
    };
    scheduleReceiptPrint(options);
    vi.runAllTimers();
    scheduleReceiptPrint(options);
    vi.runAllTimers();
    expect(print).toHaveBeenCalledTimes(1);
  });

  it('prints each partial payment, while a split payment remains one request', () => {
    vi.useFakeTimers();
    const print = vi.fn();
    const options = { attempted: new Set<string>(), print, onError: vi.fn() };
    scheduleReceiptPrint({ ...options, requestId: 'partial-1' });
    scheduleReceiptPrint({ ...options, requestId: 'partial-2-split' });
    scheduleReceiptPrint({ ...options, requestId: 'partial-2-split' });
    vi.runAllTimers();
    expect(print).toHaveBeenCalledTimes(2);
  });

  it('retains the manual fallback after a failed print without retrying automatically', () => {
    vi.useFakeTimers();
    const print = vi.fn(() => {
      throw new Error('Printing unavailable');
    });
    const onError = vi.fn();
    const options = { requestId: 'payment-1', attempted: new Set<string>(), print, onError };
    scheduleReceiptPrint(options);
    vi.runAllTimers();
    scheduleReceiptPrint(options);
    vi.runAllTimers();
    expect(print).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
