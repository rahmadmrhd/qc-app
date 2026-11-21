import type { HandoverStatus } from '@shared/handover';
import { Badge } from '@/components/ui/badge';
import { badgeColorOf, HANDOVER_STATUS_LABELS } from '../lib/status';

/** Badge status task: warna dari `badgeColorOf`, sama dengan warna kolom kanban. */
export function HandoverStatusBadge({ status }: { status: HandoverStatus }) {
  return (
    <Badge color={badgeColorOf(status)} variant="soft" dot>
      {HANDOVER_STATUS_LABELS[status]}
    </Badge>
  );
}
