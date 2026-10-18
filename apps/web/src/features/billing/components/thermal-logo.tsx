'use client';

import { ClinicLogo } from '@/components/print/clinic-logo';

/** Use the same artwork crop as A4 reports, then render pure black thermal dots. */
export function ThermalLogo({
  src,
  alt,
  className,
  onReady,
  dotWidth = 576,
}: {
  src: string;
  alt: string;
  className?: string;
  onReady?: () => void;
  dotWidth?: number;
}) {
  return (
    <ClinicLogo
      src={src}
      alt={alt}
      className={className}
      onReady={onReady}
      monochrome
      dotWidth={dotWidth}
    />
  );
}
