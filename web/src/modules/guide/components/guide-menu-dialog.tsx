import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useMe } from '@/modules/auth/use-me';
import { useActiveLocations } from '@/modules/location/active-locations-context';
import { GUIDE_CATALOG } from '../catalog';
import { eligibleGuides, type GuideOffer } from '../lib/offer';
import { useDeviceGuides } from '../lib/use-device-guides';
import { useGuideStore } from '../lib/use-guide-store';
import { useTour } from './tour/tour-provider';

/**
 * Dialog "Panduan" di menu profil: SEMUA panduan yang berhak, termasuk yang sudah selesai. Panduan tersimpan yang
 * selesai punya "Ulangi" (`reset` lalu `start`); panduan `diturunkan` selalu "Lihat lagi" (hanya `start`).
 */
export function GuideMenuDialog({ onClose }: { onClose: () => void }) {
  const me = useMe();
  const { selectedIds } = useActiveLocations();
  const { done, reset } = useGuideStore();
  const tour = useTour();
  const { relevant } = useDeviceGuides();
  const guides = eligibleGuides({
    me,
    catalog: GUIDE_CATALOG,
    relevant,
    activeLocationIds: selectedIds,
  });

  const run = async (offer: GuideOffer, finished: boolean) => {
    if (finished) {
      try {
        await reset(offer.entry.id);
      } catch {
        // Gagal menghapus penanda (offline): tur tidak dimulai, pengguna bisa mencoba lagi.
        return;
      }
    }
    onClose();
    tour.start(offer.entry);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Panduan</DialogTitle>
          <DialogDescription>Tur singkat yang bisa kamu buka kapan saja.</DialogDescription>
        </DialogHeader>
        {guides.length === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada panduan untuk akunmu.</p>
        ) : (
          <ul className="divide-y">
            {guides.map((offer) => {
              const { entry, stepCount } = offer;
              const derived = entry.status === 'diturunkan';
              const finished = !derived && (done.get(entry.id) ?? 0) >= entry.version;
              return (
                <li key={entry.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="font-medium">{entry.title}</p>
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                      {stepCount} langkah
                      {finished ? <Badge variant="secondary">Selesai</Badge> : null}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={finished || derived ? 'outline' : 'default'}
                    onClick={() => void run(offer, finished)}
                  >
                    {derived ? 'Lihat lagi' : finished ? 'Ulangi' : 'Mulai'}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
