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
import { groupGuides } from '../lib/group';
import { eligibleGuides, type GuideOffer } from '../lib/offer';
import { useDeviceGuides } from '../lib/use-device-guides';
import { useGuideStore } from '../lib/use-guide-store';
import { useTour } from './tour/tour-provider';

/**
 * Dialog "Panduan": SEMUA panduan yang berhak, termasuk yang sudah selesai, dikelompokkan menurut fitur (`grup`) dan
 * ditata dalam beberapa kolom di layar lebar. Panduan tersimpan yang selesai punya "Ulangi" (`reset` lalu `start`);
 * panduan `diturunkan` selalu "Lihat lagi" (hanya `start`). Dibuka dari menu profil dan dari info ringkas di beranda.
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
  const isDerived = (offer: GuideOffer) => offer.entry.status === 'diturunkan';
  const isFinished = (offer: GuideOffer) =>
    !isDerived(offer) && (done.get(offer.entry.id) ?? 0) >= offer.entry.version;
  const groups = groupGuides(guides);
  const tracked = guides.filter((offer) => !isDerived(offer));
  const remaining = tracked.filter((offer) => !isFinished(offer)).length;

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
      <DialogContent size="full-on-phone" className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Panduan</DialogTitle>
          <DialogDescription>
            {tracked.length === 0
              ? 'Tur singkat per fitur yang bisa kamu buka kapan saja.'
              : remaining === 0
                ? 'Semua panduan sudah kamu selesaikan. Buka lagi kapan saja lewat tombol Ulangi.'
                : `Tur singkat per fitur. ${remaining} dari ${tracked.length} panduan belum kamu selesaikan.`}
          </DialogDescription>
        </DialogHeader>
        {guides.length === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada panduan untuk akunmu.</p>
        ) : (
          // Kolom CSS (bukan grid): kelompok mengalir rapat dari atas ke bawah per kolom tanpa ruang kosong di bawah
          // kartu yang pendek, dan tiap kelompok tidak terpotong antar kolom.
          <div className="gap-3 sm:columns-2 lg:columns-3">
            {groups.map((group) => {
              const trackedInGroup = group.items.filter((offer) => !isDerived(offer));
              const finishedInGroup = trackedInGroup.filter(isFinished).length;
              const headingId = `guide-group-${group.name.split(' ').join('-')}`;
              return (
                <section
                  key={group.name}
                  aria-labelledby={headingId}
                  className="mb-3 break-inside-avoid rounded-lg border bg-card/40 p-3"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 id={headingId} className="text-sm font-semibold">
                      {group.name}
                    </h3>
                    {trackedInGroup.length > 0 ? (
                      <span className="text-xs text-muted-foreground">
                        {finishedInGroup}/{trackedInGroup.length} selesai
                      </span>
                    ) : null}
                  </div>
                  <ul className="mt-1 divide-y">
                    {group.items.map((offer) => {
                      const { entry, stepCount } = offer;
                      const derived = isDerived(offer);
                      const finished = isFinished(offer);
                      return (
                        <li key={entry.id} className="flex items-center justify-between gap-3 py-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium">{entry.title}</p>
                            <p className="flex items-center gap-2 text-xs text-muted-foreground">
                              {stepCount} langkah
                              {finished ? (
                                <Badge variant="soft" color="secondary">
                                  Selesai
                                </Badge>
                              ) : null}
                            </p>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant={finished || derived ? 'outline' : 'solid'}
                            color="primary"
                            onClick={() => void run(offer, finished)}
                          >
                            {derived ? 'Lihat lagi' : finished ? 'Ulangi' : 'Mulai'}
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
