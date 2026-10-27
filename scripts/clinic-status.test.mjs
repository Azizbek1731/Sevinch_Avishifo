import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatClinicStatus, formatNetworkStatus, summarizeLines } from './clinic-status.mjs';

describe('summarizeLines', () => {
  it('keeps non-empty lines up to the limit', () => {
    assert.deepEqual(summarizeLines('a\n\nb\nc\n', 2), ['a', 'b']);
  });
});

describe('formatClinicStatus', () => {
  it('shows health and access URLs in Uzbek', () => {
    const text = formatClinicStatus({
      checkedAt: '2026-10-20T16:40:00.000Z',
      ip: '192.168.1.110',
      healthLocal: { ok: true, status: 200, ms: 12 },
      healthLan: { ok: true, status: 200, ms: 18 },
      ports: { 80: true, 3002: true, 3003: false },
      dump: { name: 'avishifo-20261020-2139.dump', size: 413879 },
      state: { slot: '2026-10-20', telegram: true },
      stuckSyn: [],
      incompleteNeighbors: [],
    });
    assert.match(text, /klinika holati/);
    assert.match(text, /192\.168\.1\.110/);
    assert.match(text, /Portlar: 80: ochiq, 3002: ochiq, 3003: yopiq/);
    assert.match(text, /Telegramga yuborilgan/);
  });
});

describe('formatNetworkStatus', () => {
  it('lists stuck connections and incomplete neighbors', () => {
    const text = formatNetworkStatus({
      checkedAt: '2026-10-20T16:40:00.000Z',
      ip: '192.168.1.110',
      healthLan: { ok: false, status: 0, ms: 4000 },
      stuckSyn: ['192.168.1.30:80'],
      incompleteNeighbors: ['192.168.1.30'],
    });
    assert.match(text, /tarmoq holati/);
    assert.match(text, /192\.168\.1\.30:80/);
    assert.match(text, /ARP javob bermagan/);
  });
});
