import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { backupCaption, sendTelegramDocument, splitBackupFile } from './backup-telegram.mjs';

describe('backupCaption', () => {
  it('names the scheduled Tashkent slot and the real capture time', () => {
    const text = backupCaption({
      slot: '2026-10-20',
      takenAt: new Date('2026-10-20T16:40:00.000Z'),
      fileName: 'avishifo-20261020-2140.dump',
    });
    assert.match(text, /Reja: 20\.10\.2026, soat 02:00 \(Toshkent\)/);
    assert.match(text, /Olingan: 20\.10\.2026 21:40 \(Toshkent\)/);
    assert.match(text, /avishifo-20261020-2140\.dump/);
  });

  it('numbers pieces when the dump is split', () => {
    const text = backupCaption({
      slot: '2026-10-21',
      takenAt: new Date('2026-10-20T21:00:00.000Z'),
      fileName: 'avishifo.dump',
      part: 2,
      parts: 3,
    });
    assert.match(text, /Qism 2\/3/);
  });
});

describe('splitBackupFile', () => {
  it('keeps a small dump as one file and splits a larger one in order', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'avishifo-backup-'));
    const file = join(dir, 'avishifo.dump');
    writeFileSync(file, Buffer.from('abcdefghij'));
    assert.deepEqual(await splitBackupFile(file, 10), [file]);
    const parts = await splitBackupFile(file, 4);
    assert.deepEqual(
      parts.map((part) => readFileSync(part, 'utf8')),
      ['abcd', 'efgh', 'ij'],
    );
  });
});

describe('sendTelegramDocument', () => {
  it('posts the file to the group and hides the bot token if the network fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'avishifo-backup-'));
    const file = join(dir, 'avishifo.dump');
    writeFileSync(file, Buffer.from('dump'));
    const seen = [];
    await sendTelegramDocument({
      token: '12345:SECRET',
      chatId: '-1000000000001',
      filePath: file,
      caption: 'Avishifo',
      fetchImpl: async (url, init) => {
        seen.push(url);
        const chatId = init.body.get('chat_id');
        const document = init.body.get('document');
        assert.equal(chatId, '-1000000000001');
        assert.equal(document.name, 'avishifo.dump');
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      },
    });
    assert.equal(seen.length, 1);
    assert.match(seen[0], /sendDocument$/);

    await assert.rejects(
      () =>
        sendTelegramDocument({
          token: '12345:SECRET',
          chatId: '-100',
          filePath: file,
          caption: 'Avishifo',
          fetchImpl: async (url) => {
            throw new Error(`connect failed ${url}`);
          },
        }),
      (error) => {
        assert.match(error.message, /Telegram bilan aloqa yo'q/);
        assert.equal(error.message.includes('12345:SECRET'), false);
        return true;
      },
    );
  });
});
