import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { backupSlot, formatTashkent, msUntilNextBackup } from './backup-schedule.mjs';

describe('backupSlot', () => {
  it('uses the same calendar day once 02:00 Tashkent has passed', () => {
    assert.equal(backupSlot(new Date('2026-10-19T21:00:00.000Z')), '2026-10-20');
    assert.equal(backupSlot(new Date('2026-10-20T16:34:00.000Z')), '2026-10-20');
  });

  it('stays on the previous day before 02:00 Tashkent', () => {
    assert.equal(backupSlot(new Date('2026-10-20T20:59:59.000Z')), '2026-10-20');
    assert.equal(backupSlot(new Date('2026-10-19T20:59:59.000Z')), '2026-10-19');
  });
});

describe('msUntilNextBackup', () => {
  it('waits until the coming 02:00', () => {
    assert.equal(msUntilNextBackup(new Date('2026-10-19T20:00:00.000Z')), 60 * 60_000);
  });

  it('waits until tomorrow after 02:00', () => {
    assert.equal(msUntilNextBackup(new Date('2026-10-19T22:00:00.000Z')), 23 * 60 * 60_000);
    assert.equal(msUntilNextBackup(new Date('2026-10-19T21:00:00.000Z')), 24 * 60 * 60_000);
    assert.equal(msUntilNextBackup(new Date('2026-10-19T21:00:30.000Z')), 24 * 60 * 60_000 - 30_000);
  });
});

describe('formatTashkent', () => {
  it('prints the Tashkent wall clock', () => {
    assert.equal(formatTashkent(new Date('2026-10-19T21:40:00.000Z')), '20.10.2026 02:40');
  });
});
