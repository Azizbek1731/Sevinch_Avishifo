import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveDisplayBaseUrl } from './panel-url';

/**
 * The QR code printed for a TV screen is only as good as this one string.
 * It once prepended instead of swapping, producing tv.crm.<domain> — a host
 * that has never existed in DNS, so every printed code led nowhere.
 */
function atOrigin(href: string): void {
  const url = new URL(href);
  vi.stubGlobal('window', {
    location: { protocol: url.protocol, hostname: url.hostname, origin: url.origin },
  });
}

describe('resolveDisplayBaseUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.NEXT_PUBLIC_DISPLAY_URL;
  });

  it('swaps the crm subdomain for tv', () => {
    atOrigin('https://crm.avishifo.uz/settings');
    expect(resolveDisplayBaseUrl()).toBe('https://tv.avishifo.uz');
  });

  it('never yields the tv.crm host that has no DNS record', () => {
    atOrigin('https://crm.avishifo.uz/settings');
    expect(resolveDisplayBaseUrl()).not.toContain('tv.crm.');
  });

  it('keeps a deeper panel host intact apart from the swapped label', () => {
    atOrigin('https://crm.example.co.uk/');
    expect(resolveDisplayBaseUrl()).toBe('https://tv.example.co.uk');
  });

  it('points at the dev display app on localhost', () => {
    atOrigin('http://localhost:3000/settings');
    expect(resolveDisplayBaseUrl()).toBe('http://localhost:3002');
  });

  it('falls back to the same origin when the panel is not on a crm host', () => {
    atOrigin('https://avishifo.uz/settings');
    expect(resolveDisplayBaseUrl()).toBe('https://avishifo.uz');
  });

  it('lets an explicit env value win, trailing slashes trimmed', () => {
    process.env.NEXT_PUBLIC_DISPLAY_URL = 'https://ekran.klinika.uz//';
    atOrigin('https://crm.avishifo.uz/settings');
    expect(resolveDisplayBaseUrl()).toBe('https://ekran.klinika.uz');
  });
});
