import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { announceA, answerA, encodeDnsName } from './lan-names.mjs';

function query(name, type = 1, klass = 1) {
  const encoded = encodeDnsName(name);
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0x1234, 0);
  header.writeUInt16BE(1, 4);
  const tail = Buffer.alloc(4);
  tail.writeUInt16BE(type, 0);
  tail.writeUInt16BE(klass, 2);
  return Buffer.concat([header, encoded, tail]);
}

describe('answerA', () => {
  it('answers an mDNS A query with the LAN address and the cache-flush bit', () => {
    const packet = answerA(query('sevinch.local', 1, 0x8001), ['sevinch.local'], '192.168.1.110', {
      flags: 0x8400,
      ttl: 120,
      cacheFlush: true,
    });
    assert.ok(packet);
    assert.equal(packet.readUInt16BE(0), 0x1234);
    assert.equal(packet.readUInt16BE(2), 0x8400);
    assert.equal(packet.readUInt16BE(4), 1);
    assert.equal(packet.readUInt16BE(6), 1);
    const pointer = packet.indexOf(Buffer.from([0xc0, 0x0c]));
    assert.equal(packet.readUInt16BE(pointer + 2), 1);
    assert.equal(packet.readUInt16BE(pointer + 4), 0x8001);
    assert.deepEqual([...packet.subarray(packet.length - 4)], [192, 168, 1, 110]);
  });

  it('answers LLMNR without the cache-flush bit', () => {
    const packet = answerA(query('sevinch'), ['sevinch'], '192.168.1.110', {
      flags: 0x8000,
      ttl: 30,
      cacheFlush: false,
    });
    assert.ok(packet);
    assert.equal(packet.readUInt16BE(2), 0x8000);
    const pointer = packet.indexOf(Buffer.from([0xc0, 0x0c]));
    assert.equal(packet.readUInt16BE(pointer + 4), 0x0001);
  });

  it('ignores AAAA queries, replies, and other names', () => {
    const options = { flags: 0x8400, ttl: 120, cacheFlush: true };
    assert.equal(answerA(query('sevinch.local', 28), ['sevinch.local'], '192.168.1.110', options), null);
    const response = query('sevinch.local');
    response[2] = 0x84;
    assert.equal(answerA(response, ['sevinch.local'], '192.168.1.110', options), null);
    assert.equal(answerA(query('other.local'), ['sevinch.local'], '192.168.1.110', options), null);
    assert.equal(answerA(query('sevinch.local'), ['sevinch.local'], 'not-an-ip', options), null);
  });
});

describe('announceA', () => {
  it('publishes the name with no question', () => {
    const packet = announceA('sevinch.local', '192.168.1.110', {
      flags: 0x8400,
      ttl: 120,
      cacheFlush: true,
    });
    assert.ok(packet);
    assert.equal(packet.readUInt16BE(4), 0);
    assert.equal(packet.readUInt16BE(6), 1);
    assert.deepEqual([...packet.subarray(packet.length - 4)], [192, 168, 1, 110]);
  });
});
