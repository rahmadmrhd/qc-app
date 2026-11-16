import { Camera, CircleAlert } from 'lucide-react';
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

/**
 * Penanda entri yang foto bukti QC-nya gagal diproses ("Foto bermasalah"); dipasang berdampingan dengan `ProofBadge`
 * bila `proofProblemCount > 0`. Jumlahnya dibaca pembaca layar lewat `title`/teks tersembunyi.
 */
export function ProofProblemBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <Badge variant="destructive" className="gap-1">
      <CircleAlert aria-hidden className="size-3" />
      Foto bermasalah
      <span className="sr-only">{` (${count})`}</span>
    </Badge>
  );
}
