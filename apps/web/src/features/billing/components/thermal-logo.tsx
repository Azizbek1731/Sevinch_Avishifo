'use client';

import { useEffect, useState } from 'react';

/**
 * A clinic logo prepared for a thermal head.
 *
 * Thermal printers are one-bit: every dot is burned or it is not. Handed an
 * ordinary colour logo the driver dithers it, and the mid-tones — 29% of the
 * pixels in a typical brand mark — come out as a grey stipple that reads as a
 * smudge rather than a logo.
 *
 * So the image is thresholded to pure black and white here, before it ever
 * reaches the driver, and the browser is told not to smooth it when scaling.
 * Transparency is composited onto white first, otherwise a transparent
 * background thresholds to black and the logo prints as a solid slab.
 */
export function ThermalLogo({
  src,
  alt,
  className,
  onReady,
}: {
  src: string;
  alt: string;
  className?: string;
  onReady?: () => void;
}) {
  const [processed, setProcessed] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        // Resample to roughly the width it occupies on the strip before
        // thresholding, so the threshold is the LAST operation and no smoothing
        // can reintroduce grey afterwards. 384 is the dot count across a 58mm
        // head, so this is about one canvas pixel per printed dot.
        const targetWidth = Math.min(img.naturalWidth, 384);
        const scale = targetWidth / img.naturalWidth;
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no 2d context');

        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);

        const image = ctx.getImageData(0, 0, w, h);
        const d = image.data;
        for (let i = 0; i < d.length; i += 4) {
          // Perceptual luminance against a mid threshold. Biasing darker — as a
          // first attempt did — floods a blue brand mark to a solid slab,
          // because blue contributes barely a tenth of perceived luminance and
          // every shade of it lands under the cut. The midpoint keeps the
          // lighter half of a gradient white, which is what gives the printed
          // mark its shape.
          const lum = 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
          const on = lum < 128 ? 0 : 255;
          d[i] = on;
          d[i + 1] = on;
          d[i + 2] = on;
          d[i + 3] = 255;
        }
        ctx.putImageData(image, 0, 0);
        if (!cancelled) setProcessed(canvas.toDataURL('image/png'));
      } catch {
        // A cross-origin logo taints the canvas. Printing the original is worse
        // than this, but better than printing nothing.
        if (!cancelled) setFailed(true);
      }
    };
    img.onerror = () => !cancelled && setFailed(true);
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);

  // Until it is ready, render nothing rather than flashing the colour original —
  // the off-screen printer mounts and prints within a frame or two.
  if (!processed && !failed) return null;

  return (
    <img
      src={processed ?? src}
      alt={alt}
      className={className}
      onLoad={onReady}
      onError={onReady}
      // Nearest-neighbour: any residual scaling must not blur the black edges
      // back into grey.
      style={{ imageRendering: 'pixelated' }}
    />
  );
}
