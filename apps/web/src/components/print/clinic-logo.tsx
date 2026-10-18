'use client';

import { useEffect, useState } from 'react';
import { API_URL } from '@/lib/api-client';

/** Logos may be inline raster data, an absolute URL, or an API-relative upload. */
export function clinicLogoUrl(src: string | null | undefined): string | null {
  if (!src?.trim()) return null;
  const value = src.trim();
  if (/^(data:image\/(?:png|jpe?g|webp|gif);base64,|https?:\/\/|blob:)/i.test(value)) {
    return value;
  }
  if (value.startsWith('/')) return `${API_URL.replace(/\/$/, '')}${value}`;
  return null;
}

/**
 * Fit the supplied artwork, not its scanner/export whitespace, into a letterhead.
 * The stored logo is untouched. Colour pixels are preserved; thermal output is
 * composited onto white and converted to black dots for a receipt printer.
 */
export function ClinicLogo({
  src,
  alt = '',
  className,
  monochrome = false,
  dotWidth = 576,
  onReady,
}: {
  src: string;
  alt?: string;
  className?: string;
  monochrome?: boolean;
  dotWidth?: number;
  onReady?: () => void;
}) {
  const resolved = clinicLogoUrl(src);
  const [result, setResult] = useState<{ source: string; url: string } | null>(null);

  useEffect(() => {
    if (!resolved) return;
    let cancelled = false;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    const fallback = () => !cancelled && setResult({ source: resolved, url: resolved });
    image.onload = () => {
      try {
        const width = image.naturalWidth;
        const height = image.naturalHeight;
        // Do not allocate an unbounded canvas for an accidental oversized upload.
        if (!width || !height || width * height > 16_000_000) throw new Error('Logo too large');
        const source = document.createElement('canvas');
        source.width = width;
        source.height = height;
        const context = source.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('Canvas unavailable');
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, width, height).data;
        let left = width;
        let top = height;
        let right = -1;
        let bottom = -1;
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const index = (y * width + x) * 4;
            if (
              pixels[index + 3]! > 16 &&
              Math.min(pixels[index]!, pixels[index + 1]!, pixels[index + 2]!) < 245
            ) {
              left = Math.min(left, x);
              right = Math.max(right, x);
              top = Math.min(top, y);
              bottom = Math.max(bottom, y);
            }
          }
        }
        if (right < left || bottom < top) throw new Error('Empty logo');
        const padding = Math.ceil(Math.max(right - left + 1, bottom - top + 1) * 0.015);
        left = Math.max(0, left - padding);
        top = Math.max(0, top - padding);
        right = Math.min(width - 1, right + padding);
        bottom = Math.min(height - 1, bottom + padding);
        const croppedWidth = right - left + 1;
        const croppedHeight = bottom - top + 1;
        const scale = Math.min(1, (monochrome ? dotWidth : 1200) / croppedWidth);
        const output = document.createElement('canvas');
        output.width = Math.max(1, Math.round(croppedWidth * scale));
        output.height = Math.max(1, Math.round(croppedHeight * scale));
        const outputContext = output.getContext('2d');
        if (!outputContext) throw new Error('Canvas unavailable');
        outputContext.fillStyle = '#fff';
        outputContext.fillRect(0, 0, output.width, output.height);
        outputContext.drawImage(
          source,
          left,
          top,
          croppedWidth,
          croppedHeight,
          0,
          0,
          output.width,
          output.height,
        );
        if (monochrome) {
          const outputPixels = outputContext.getImageData(0, 0, output.width, output.height);
          const data = outputPixels.data;
          for (let i = 0; i < data.length; i += 4) {
            const luminance = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
            const dot = luminance < 128 ? 0 : 255;
            data[i] = dot;
            data[i + 1] = dot;
            data[i + 2] = dot;
            data[i + 3] = 255;
          }
          outputContext.putImageData(outputPixels, 0, 0);
        }
        const url = output.toDataURL('image/png');
        source.width = source.height = output.width = output.height = 0;
        if (!cancelled) setResult({ source: resolved, url });
      } catch {
        fallback();
      }
    };
    image.onerror = fallback;
    image.src = resolved;
    return () => {
      cancelled = true;
    };
  }, [resolved, monochrome, dotWidth]);

  useEffect(() => {
    if (!resolved) onReady?.();
  }, [resolved, onReady]);

  if (!resolved || result?.source !== resolved) return null;
  return (
    <img
      src={result.url}
      alt={alt}
      className={className}
      onLoad={onReady}
      onError={onReady}
      style={monochrome ? { imageRendering: 'pixelated', filter: 'grayscale(1)' } : undefined}
    />
  );
}
