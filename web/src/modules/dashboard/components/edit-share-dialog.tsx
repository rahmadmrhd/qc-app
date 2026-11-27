import type { DashboardShareDetailDto } from '@shared/dashboard-share';
import { wibDateIso } from '@shared/postel';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { describeError } from '@/lib/api/describe-error';
import { shareDetailQueryOptions } from '../share-queries';
import { ShareDialog } from './share-dialog';

/**
 * Dialog Ubah tautan manual: memuat detail tautan (`dashboardShares.get`) lalu membuka `ShareDialog` dalam mode ubah.
 * Detail dibekukan saat pertama termuat supaya muat ulang di latar (setelah simpan) tidak mengganti isian atau alamat
 * pembanding hasil. Tautan terbitan laporan terjadwal tidak diubah di sini (pemanggil mengarahkan ke form laporannya).
 */
export function EditShareDialog({ shareId, onClose }: { shareId: string; onClose: () => void }) {
  const detail = useQuery(shareDetailQueryOptions(shareId));
  const [frozen, setFrozen] = useState<DashboardShareDetailDto | null>(null);
  if (frozen === null && detail.data) setFrozen(detail.data);
  if (frozen) {
    return <ShareDialog editing={frozen} today={wibDateIso(Date.now())} onClose={onClose} />;
  }
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ubah tautan</DialogTitle>
          <DialogDescription>
            {detail.isError ? describeError(detail.error) : 'Memuat tautan…'}
          </DialogDescription>
        </DialogHeader>
        {detail.isError ? (
          <DialogFooter>
            <Button type="button" variant="outline" color="primary" onClick={onClose}>
              Tutup
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
