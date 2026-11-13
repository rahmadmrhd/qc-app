import { GUIDE_VERSIONS } from '@shared/guides';
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
import { useBlockingOnboardingActive } from '@/modules/push/components/push-onboarding';
import { GREETING_ID, greetingDue } from '../lib/offer';
import { useGuideStore } from '../lib/use-guide-store';
import { useOfferedGuides } from '../lib/use-offered-guides';
import { useTour } from './tour/tour-provider';

/**
 * Sapaan login (spek 4.4): SATU dialog "Mau tur singkat?" bagi yang belum punya penanda `sapaan-awal`. Mulai
 * menjalankan panduan dasar pertama yang ditawarkan; Mulai maupun Nanti menulis penanda (tidak ditanya lagi).
 * Ditunda selama tur berjalan atau dialog/banner onboarding push tampil, dan tak muncul bila belum `ready` atau tak
 * ada panduan dasar yang bisa ditawarkan.
 */
export function GuideGreeting() {
  const { ready, done, mark } = useGuideStore();
  const { offers } = useOfferedGuides();
  const tour = useTour();
  const blocked = useBlockingOnboardingActive();
  // Langsung tertutup setelah dijawab, tanpa menunggu penanda tersimpan (server) kembali.
  const [answered, setAnswered] = useState(false);

  const first = offers.find(({ entry }) => entry.kind === 'dasar' && entry.status === 'disimpan');
  const open = ready && greetingDue(done) && !answered && !tour.active && !blocked && !!first;

  const answer = (startTour: boolean) => {
    setAnswered(true);
    mark(GREETING_ID, GUIDE_VERSIONS['sapaan-awal']).catch(() => undefined);
    if (startTour && first) tour.start(first.entry);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) answer(false);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mau tur singkat?</DialogTitle>
          <DialogDescription>
            Kenalan dulu sama tampilan aplikasinya, cuma beberapa langkah. Panduan lainnya selalu
            ada di menu profil.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => answer(false)}>
            Nanti
          </Button>
          <Button onClick={() => answer(true)}>Mulai</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
