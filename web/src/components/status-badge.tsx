import { Badge } from '@/components/ui/badge';

/**
 * Badge status Aktif/Nonaktif, satu-satunya pemetaan status → warna untuk master data (spek redesain §6.2):
 * aktif = `success`, selain itu `secondary`. `label` menimpa teks bawaan (mis. label status stiker).
 */
export function ActiveStatusBadge({ status, label }: { status: string; label?: string }) {
  const active = status === 'active';
  return (
    <Badge color={active ? 'success' : 'secondary'} variant="soft" dot>
      {label ?? (active ? 'Aktif' : 'Nonaktif')}
    </Badge>
  );
}
