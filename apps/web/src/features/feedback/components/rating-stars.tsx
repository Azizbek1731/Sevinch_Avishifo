import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface RatingStarsProps {
  rating: number;
  className?: string;
  /** Icon size class, default h-4 w-4. */
  sizeClassName?: string;
}

/** Row of 5 stars, filled up to `rating`. */
export function RatingStars({ rating, className, sizeClassName = 'h-4 w-4' }: RatingStarsProps) {
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={cn(
            sizeClassName,
            i <= Math.round(rating)
              ? 'fill-warning text-warning'
              : 'fill-muted text-muted-foreground/40',
          )}
        />
      ))}
    </span>
  );
}
