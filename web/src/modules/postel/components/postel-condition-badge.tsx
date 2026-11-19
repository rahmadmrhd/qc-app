import type { PostelCondition } from '@shared/postel';
import { Badge } from '@/components/ui/badge';
import type { UiColor } from '@/components/ui/variant-style';
import { CONDITION_LABEL } from '../lib/condition';

/** Berlaku = success, Segera habis = warning, Kedaluwarsa = destructive (badge status soft + titik). */
const CONDITION_COLOR: Record<PostelCondition, UiColor> = {
  valid: 'success',
  soon: 'warning',
  expired: 'destructive',
};

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
    <Badge color={CONDITION_COLOR[condition]} variant="soft" dot className={className}>
      {label ?? CONDITION_LABEL[condition]}
    </Badge>
  );
}
