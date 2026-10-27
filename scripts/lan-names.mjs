/** DNS name packets for the clinic LAN (mDNS and LLMNR). */

export function encodeDnsName(name) {
  return Buffer.concat([
    ...name
      .split('.')
      .filter((part) => part.length > 0)
      .map((part) => Buffer.concat([Buffer.from([part.length]), Buffer.from(part)])),
    Buffer.from([0]),
  ]);
}

export function decodeDnsName(buf, offset) {
  const labels = [];
  let pos = offset;
  let jumped = false;
  let end = offset;
  for (let guard = 0; guard < 20 && pos < buf.length; guard += 1) {
    const len = buf[pos];
    if (len === 0) {
      if (!jumped) end = pos + 1;
      break;
    }
    if ((len & 0xc0) === 0xc0) {
      if (pos + 1 >= buf.length) break;
      if (!jumped) end = pos + 2;
      jumped = true;
      pos = ((len & 0x3f) << 8) | buf[pos + 1];
      continue;
    }
    if (pos + 1 + len > buf.length) break;
    labels.push(buf.subarray(pos + 1, pos + 1 + len).toString('utf8'));
    pos += 1 + len;
    if (!jumped) end = pos;
  }
  return { name: labels.join('.').toLowerCase(), end };
}

function questions(message) {
  if (message.length < 12) return [];
  const count = message.readUInt16BE(4);
  const found = [];
  let offset = 12;
  for (let i = 0; i < count && i < 8; i += 1) {
    const decoded = decodeDnsName(message, offset);
    if (decoded.end + 4 > message.length) break;
    found.push({
      name: decoded.name,
      type: message.readUInt16BE(decoded.end),
      klass: message.readUInt16BE(decoded.end + 2),
    });
    offset = decoded.end + 4;
  }
  return found;
}

function writeIpv4(target, offset, ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  for (let i = 0; i < 4; i += 1) {
    const octet = Number(parts[i]);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return false;
    target[offset + i] = octet;
  }
  return true;
}

function aRecord(nameEncoding, ip, { ttl, cacheFlush }) {
  const record = Buffer.alloc(nameEncoding.length + 10 + 4);
  nameEncoding.copy(record, 0);
  const at = nameEncoding.length;
  record.writeUInt16BE(1, at);
  record.writeUInt16BE(cacheFlush ? 0x8001 : 0x0001, at + 2);
  record.writeUInt32BE(ttl, at + 4);
  record.writeUInt16BE(4, at + 8);
  if (!writeIpv4(record, at + 10, ip)) return null;
  return record;
}

/**
 * One-question A reply. `names` is the list of names this host owns.
 * Returns null for responses, AAAA queries, and names we do not own.
 * The question is echoed, including the QU bit, so Windows accepts the packet.
 */
export function answerA(query, names, ip, { flags, ttl, cacheFlush }) {
  if (query.length < 12 || (query[2] & 0x80) !== 0) return null;
  const question = questions(query)[0];
  const owned = new Set(names.map((name) => name.toLowerCase()));
  if (!question || !owned.has(question.name)) return null;
  if (question.type !== 1 && question.type !== 255) return null;
  const encoded = encodeDnsName(question.name);
  const header = Buffer.alloc(12);
  header.writeUInt16BE(query.readUInt16BE(0), 0);
  header.writeUInt16BE(flags, 2);
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(1, 6);
  const echoed = Buffer.alloc(encoded.length + 4);
  encoded.copy(echoed, 0);
  echoed.writeUInt16BE(question.type, encoded.length);
  echoed.writeUInt16BE(question.klass, encoded.length + 2);
  const answer = aRecord(Buffer.from([0xc0, 0x0c]), ip, { ttl, cacheFlush });
  if (!answer) return null;
  return Buffer.concat([header, echoed, answer]);
}

/** Unsolicited announcement (no question section). */
export function announceA(name, ip, { flags, ttl, cacheFlush }) {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(flags, 2);
  header.writeUInt16BE(1, 6);
  const answer = aRecord(encodeDnsName(name), ip, { ttl, cacheFlush });
  if (!answer) return null;
  return Buffer.concat([header, answer]);
}
