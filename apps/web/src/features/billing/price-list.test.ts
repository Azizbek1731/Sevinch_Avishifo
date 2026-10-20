import { describe, expect, it } from 'vitest';
import { listedLine } from './price-list';

describe('listedLine', () => {
  it('uses the catalogue price when the list has no row', () => {
    expect(listedLine('15000.00', null, 1)).toEqual({
      unitPrice: '15000.00',
      discount: '0.00',
    });
  });

  it('writes the gap as a discount and keeps the catalogue unit price', () => {
    expect(listedLine('15000.00', '9000.00', 1)).toEqual({
      unitPrice: '15000.00',
      discount: '6000.00',
    });
  });

  it('multiplies the gap by quantity', () => {
    expect(listedLine('40000.00', '24000.00', 2)).toEqual({
      unitPrice: '40000.00',
      discount: '32000.00',
    });
  });

  it('does not raise the price when the list is the same or higher', () => {
    expect(listedLine('100000.00', '100000.00', 1)).toEqual({
      unitPrice: '100000.00',
      discount: '0.00',
    });
    expect(listedLine('40000.00', '50000.00', 1)).toEqual({
      unitPrice: '40000.00',
      discount: '0.00',
    });
  });
});
