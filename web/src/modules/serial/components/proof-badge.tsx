import { Camera } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

/** Penanda entri yang punya foto bukti QC (daftar, kepala detail, dan kartu riwayat). */
export function ProofBadge() {
  return (
    <Badge variant="outline" className="gap-1">
      <Camera aria-hidden className="size-3" />
      Bukti foto QC
    </Badge>
  );
}
