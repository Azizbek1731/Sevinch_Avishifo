import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { formalClinicName, preparePdfClinicLogo } from './clinic-letterhead';

describe('clinical PDF branding', () => {
  it('uses the formal clinic identity with a display-name fallback', () => {
    const clinic = { name: 'Display clinic', legalName: 'Legal clinic', address: null, phone: null };
    expect(formalClinicName(clinic)).toBe('Legal clinic');
    expect(formalClinicName({ ...clinic, legalName: ' ' })).toBe('Display clinic');
  });

  it('removes surrounding white space from an inline logo without stretching it', async () => {
    const mark = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#164c91' } }).png().toBuffer();
    const original = await sharp({ create: { width: 100, height: 80, channels: 3, background: '#ffffff' } })
      .composite([{ input: mark, left: 30, top: 30 }]).png().toBuffer();
    const result = await preparePdfClinicLogo(`data:image/png;base64,${original.toString('base64')}`);
    expect(result).not.toBeNull();
    const metadata = await sharp(result!).metadata();
    expect(metadata.format).toBe('png');
    expect(metadata.width).toBe(40);
    expect(metadata.height).toBe(20);
  });

  it('does not load URLs, paths, SVGs, oversized or corrupt inline images', async () => {
    for (const value of [
      'https://example.com/logo.png',
      'http://127.0.0.1/private',
      'file:///private/keys',
      '/uploads/logo.png',
      'data:image/svg+xml;base64,PHN2Zy8+',
      'data:image/png;base64,AAAA',
      `data:image/png;base64,${'A'.repeat(800_001)}`,
    ]) expect(await preparePdfClinicLogo(value)).toBeNull();
  });

  it('trims a large square upload before resizing the visible mark', async () => {
    const mark = await sharp({ create: { width: 1200, height: 400, channels: 3, background: '#164c91' } }).png().toBuffer();
    const original = await sharp({ create: {
      width: 2160, height: 2160, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 },
    } })
      .composite([{ input: mark, left: 400, top: 900 }]).png().toBuffer();
    const result = await preparePdfClinicLogo(`data:image/png;base64,${original.toString('base64')}`);
    const metadata = await sharp(result!).metadata();
    expect(metadata.width).toBe(900);
    expect(metadata.height).toBe(300);
  });

  it('checks actual bytes rather than trusting the declared image type', async () => {
    const jpeg = await sharp({ create: { width: 12, height: 8, channels: 3, background: '#164c91' } })
      .jpeg().toBuffer();
    expect(await preparePdfClinicLogo(`data:image/png;base64,${jpeg.toString('base64')}`)).toBeNull();
    expect(await preparePdfClinicLogo(`data:image/jpeg;base64,${jpeg.toString('base64')}`)).not.toBeNull();
  });
});
