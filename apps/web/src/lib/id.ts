/**
 * Identifier for payments and print dialogs.
 * `crypto.randomUUID` throws on plain HTTP except for localhost, so a clinic
 * computer that opens the server by name still gets a UUID.
 */
export function createId(): string {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi) throw new Error('crypto is not available');
  if (typeof cryptoApi.randomUUID === 'function') {
    try {
      return cryptoApi.randomUUID();
    } catch {
      // Insecure context. getRandomValues still works.
    }
  }
  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  const sixth = bytes[6] ?? 0;
  const eighth = bytes[8] ?? 0;
  bytes[6] = (sixth & 0x0f) | 0x40;
  bytes[8] = (eighth & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
