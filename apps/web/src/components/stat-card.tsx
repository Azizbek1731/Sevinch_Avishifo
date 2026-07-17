import * as React from 'react';
import { TrendingDown, TrendingUp, type LucideIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface StatCardProps {
  title: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  /** Small helper text under the value. */
  hint?: string;
  /** Percentage change vs previous period; positive renders green, negative red. */
  trend?: number;
  className?: string;
}

export function StatCard({ title, value, icon: Icon, hint, trend, className }: StatCardProps) {
  const trendPositive = typeof trend === 'number' && trend > 0;
  const trendNegative = typeof trend === 'number' && trend < 0;

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        {Icon ? <Icon className="h-4 w-4 text-muted-foreground" /> : null}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {typeof trend === 'number' || hint ? (
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            {typeof trend === 'number' ? (
              <span
                className={cn(
                  'inline-flex items-center gap-1 font-medium',
                  trendPositive && 'text-success',
                  trendNegative && 'text-destructive',
                )}
              >
                {trendPositive ? (
                  <TrendingUp className="h-3.5 w-3.5" />
                ) : trendNegative ? (
                  <TrendingDown className="h-3.5 w-3.5" />
                ) : null}
                {trend > 0 ? `+${trend}%` : `${trend}%`}
              </span>
            ) : null}
            {hint ? <span>{hint}</span> : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
