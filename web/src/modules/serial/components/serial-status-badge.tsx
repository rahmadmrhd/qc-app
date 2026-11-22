import type { SerialStatus } from '@shared/serials';
import { Badge } from '@/components/ui/badge';
import { STATUS_LABEL } from '../lib/labels';

/** Warna status alur serial: Lolos = success, Rusak = destructive, status penanganan di antaranya = warning. */
const STATUS_COLOR = {
  good: 'success',
  broken: 'destructive',
} as const;

/** Badge status alur serial (satu-satunya pemetaan status → warna di modul Serial Number). */
export function SerialStatusBadge({ status }: { status: SerialStatus }) {
  const color = status === 'good' || status === 'broken' ? STATUS_COLOR[status] : 'warning';
  return (
    <Badge color={color} variant="soft">
      {STATUS_LABEL[status]}
    </Badge>
  );
}
