import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

// Accepts a relative root ("." from the package script); createRequire needs absolute.
const root = resolve(process.argv[2] ?? '.');
// sharp lives in the pnpm store rather than as a direct dependency, so resolve
// it from the repo root instead of relying on this script's own module paths.
const require = createRequire(join(root, 'package.json'));
const sharp = require('sharp');
const svgDir = join(root, 'logo/svg');
const pngDir = join(root, 'logo/png');
const socialDir = join(root, 'logo/social');
mkdirSync(pngDir, { recursive: true });
mkdirSync(socialDir, { recursive: true });

const full = readFileSync(join(svgDir, 'avishifo-mark.svg'));
const simple = readFileSync(join(svgDir, 'avishifo-mark-simple.svg'));
const lockup = readFileSync(join(svgDir, 'avishifo-lockup.svg'));
const lockupDark = readFileSync(join(svgDir, 'avishifo-lockup-dark.svg'));

/**
 * Below 32px the full mark's chip pins collapse into noise, so those sizes are
 * rendered from the simplified variant instead. Everything from 32 up uses the
 * full mark.
 */
const SIMPLE_BELOW = 32;
const MARK_SIZES = [16, 20, 24, 32, 48, 64, 96, 128, 180, 192, 256, 384, 512, 1024];

const out = [];

for (const size of MARK_SIZES) {
  const src = size < SIMPLE_BELOW ? simple : full;
  const file = join(pngDir, `avishifo-mark-${size}.png`);
  await sharp(src, { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toFile(file);
  out.push(`mark-${size}.png`);
}

// Lockups: width-driven, height follows the 260×64 aspect.
for (const width of [320, 640, 1280, 2560]) {
  await sharp(lockup, { density: 384 })
    .resize({ width })
    .png({ compressionLevel: 9 })
    .toFile(join(pngDir, `avishifo-lockup-${width}.png`));
  await sharp(lockupDark, { density: 384 })
    .resize({ width })
    .png({ compressionLevel: 9 })
    .toFile(join(pngDir, `avishifo-lockup-dark-${width}.png`));
  out.push(`lockup-${width}.png`, `lockup-dark-${width}.png`);
}

/**
 * Social/app-store art needs a filled canvas — transparent PNGs render badly on
 * unpredictable backgrounds and are rejected by some stores.
 */
async function onCanvas(src, w, h, background, markRatio, file) {
  const markSize = Math.round(Math.min(w, h) * markRatio);
  const mark = await sharp(src, { density: 384 }).resize(markSize, markSize).png().toBuffer();
  await sharp({ create: { width: w, height: h, channels: 4, background } })
    .composite([{ input: mark, gravity: 'centre' }])
    .png({ compressionLevel: 9 })
    .toFile(file);
}

const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };
const INK = { r: 15, g: 23, b: 42, alpha: 1 };

// Apple touch icon: iOS puts it on an opaque tile and rounds the corners itself.
await onCanvas(full, 180, 180, WHITE, 0.72, join(pngDir, 'apple-touch-icon-180.png'));
// Maskable Android icon: the launcher may crop to a circle, so keep 20% padding.
await onCanvas(full, 512, 512, WHITE, 0.6, join(pngDir, 'maskable-512.png'));
// Open Graph / Telegram link preview.
await onCanvas(full, 1200, 630, WHITE, 0.42, join(socialDir, 'og-light-1200x630.png'));
await onCanvas(full, 1200, 630, INK, 0.42, join(socialDir, 'og-dark-1200x630.png'));
out.push('apple-touch-icon-180.png', 'maskable-512.png', 'og-light-1200x630.png', 'og-dark-1200x630.png');

// favicon.ico with the three sizes browsers actually pick from.
const icoSizes = [16, 32, 48];
const buffers = await Promise.all(
  icoSizes.map((s) =>
    sharp(s < SIMPLE_BELOW ? simple : full, { density: 384 }).resize(s, s).png().toBuffer(),
  ),
);
// Minimal ICO container: 6-byte header + 16-byte directory per image + PNG payloads.
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(icoSizes.length, 4);
let offset = 6 + 16 * icoSizes.length;
const dirs = [];
for (let i = 0; i < icoSizes.length; i++) {
  const d = Buffer.alloc(16);
  d.writeUInt8(icoSizes[i] === 256 ? 0 : icoSizes[i], 0);
  d.writeUInt8(icoSizes[i] === 256 ? 0 : icoSizes[i], 1);
  d.writeUInt8(0, 2);
  d.writeUInt8(0, 3);
  d.writeUInt16LE(1, 4);
  d.writeUInt16LE(32, 6);
  d.writeUInt32LE(buffers[i].length, 8);
  d.writeUInt32LE(offset, 12);
  offset += buffers[i].length;
  dirs.push(d);
}
writeFileSync(join(root, 'logo/favicon.ico'), Buffer.concat([header, ...dirs, ...buffers]));
out.push('favicon.ico');

console.log(`${out.length} ta fayl chiqarildi`);
