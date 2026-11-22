import { Badge } from '@/components/ui/badge';

/** Penanda record terhapus (soft delete) pada daftar, rujukan, dan chip `LinkField` (rancangan soft delete §4.4). */
export function DeletedBadge() {
  return (
    <Badge color="secondary" variant="soft">
      Terhapus
    </Badge>
  );
}
