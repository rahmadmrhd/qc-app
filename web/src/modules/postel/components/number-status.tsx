import type { PostelCondition, PostelRole } from '@shared/postel';
import { numberStatusLabel, ROLE_LABEL } from '../lib/condition';
import { PostelConditionBadge } from './postel-condition-badge';

/**
 * Status satu nomor: lencana "Aktif · Kondisi" atau "Lama · Kedaluwarsa"; nomor Lama yang belum kedaluwarsa (atau
 * nomor tanpa tanggal sah, `condition` null) cukup berupa teks peran.
 */
export function NumberStatus({
  role,
  condition,
}: {
  role: PostelRole;
  condition: PostelCondition | null;
}) {
  if (condition === null || (role === 'old' && condition !== 'expired'))
    return (
      <span className="text-sm text-muted-foreground">
        {condition === null ? ROLE_LABEL[role] : numberStatusLabel(role, condition)}
      </span>
    );
  return <PostelConditionBadge condition={condition} label={numberStatusLabel(role, condition)} />;
}
