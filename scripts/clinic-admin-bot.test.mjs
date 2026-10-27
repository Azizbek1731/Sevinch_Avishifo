import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import {
  adminKeyboard,
  handleAdminUpdate,
  isAllowedAdmin,
  normalizeCommand,
  serverStartedMessage,
  serverStoppedMessage,
} from './clinic-admin-bot.mjs';

describe('normalizeCommand', () => {
  it('maps Uzbek buttons and slash commands', () => {
    assert.equal(normalizeCommand('Holat'), 'holat');
    assert.equal(normalizeCommand('/tarmoq@MyBot'), 'tarmoq');
    assert.equal(normalizeCommand('wifi ulana olmayapti'), 'tarmoq');
    assert.equal(normalizeCommand('Zaxira'), 'zaxira');
  });
});

describe('isAllowedAdmin', () => {
  it('allows only configured admin ids', () => {
    assert.equal(isAllowedAdmin({ message: { from: { id: 1884336974 } } }, [1884336974]), true);
    assert.equal(isAllowedAdmin({ message: { from: { id: 1 } } }, [1884336974]), false);
  });
});

describe('lifecycle messages', () => {
  it('describes start, unexpected restart, and stop', () => {
    assert.match(
      serverStartedMessage({ when: '22.10.2026 18:00', ip: '192.168.1.110' }),
      /server yoqildi/,
    );
    assert.match(
      serverStartedMessage({
        when: '22.10.2026 18:00',
        ip: '192.168.1.110',
        unexpected: true,
      }),
      /kutilmaganda/,
    );
    assert.match(serverStoppedMessage({ when: '22.10.2026 18:05' }), /o‘chmoqda/);
  });
});

describe('handleAdminUpdate', () => {
  it('replies with status text for the admin', async () => {
    const calls = [];
    const fetchImpl = mock.fn(async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: {} }),
      };
    });
    await handleAdminUpdate(
      { message: { chat: { id: 1884336974 }, from: { id: 1884336974 }, text: 'Holat' } },
      {
        token: 'TESTTOKEN',
        adminIds: [1884336974],
        backupDir: null,
        fetchImpl,
        spawnSyncImpl: () => ({ status: 1, stdout: '', stderr: '' }),
      },
    );
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /sendMessage$/);
    assert.match(calls[0].body.text, /klinika holati/);
    assert.deepEqual(calls[0].body.reply_markup.keyboard, adminKeyboard().keyboard);
  });
});
