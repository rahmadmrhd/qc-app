import type { PostelCondition } from '@shared/postel';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { CONDITION_LABEL } from '../lib/condition';

/** "Segera habis" memakai warna peringatan (tema ini belum punya varian warning pada `Badge`). */
const SOON_CLASS =
  'border-transparent bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200';

export function PostelConditionBadge({
  condition,
  label,
  className,
}: {
  condition: PostelCondition;
  /** Teks pengganti (mis. "Aktif · Kedaluwarsa"); bawaan label kondisinya. */
  label?: string;
  className?: string;
}) {
  return (
    <Badge
      variant={
        condition === 'expired' ? 'destructive' : condition === 'soon' ? 'outline' : 'secondary'
      }
      className={cn(condition === 'soon' && SOON_CLASS, className)}
    >
      {label ?? CONDITION_LABEL[condition]}
    </Badge>
  );
}
