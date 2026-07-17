import type { CSSProperties } from 'react';

/** Theme-token chart colors — resolve to the active light/dark palette at render time. */
export const CHART_COLORS = {
  primary: 'hsl(var(--primary))',
  success: 'hsl(var(--success))',
  warning: 'hsl(var(--warning))',
  muted: 'hsl(var(--muted-foreground))',
  grid: 'hsl(var(--border))',
} as const;

export const tooltipContentStyle: CSSProperties = {
  backgroundColor: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border))',
  borderRadius: '0.5rem',
  color: 'hsl(var(--card-foreground))',
  fontSize: '0.75rem',
  boxShadow: '0 4px 12px rgb(0 0 0 / 0.08)',
};

export const tooltipLabelStyle: CSSProperties = {
  color: 'hsl(var(--muted-foreground))',
  marginBottom: 4,
};

export const tooltipItemStyle: CSSProperties = {
  color: 'hsl(var(--card-foreground))',
};

export const axisTick = {
  fill: 'hsl(var(--muted-foreground))',
  fontSize: 12,
} as const;

export const legendTextStyle: CSSProperties = {
  color: 'hsl(var(--muted-foreground))',
};
