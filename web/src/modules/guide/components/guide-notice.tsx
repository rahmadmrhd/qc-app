import { GraduationCap } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useBlockingOnboardingActive } from '@/modules/push/components/push-onboarding';
import { useOfferedGuides } from '../lib/use-offered-guides';
import { GuideMenuDialog } from './guide-menu-dialog';

/**
 * Info ringkas di beranda: ada panduan yang belum dimulai (spek 4.4). Hanya memberi tahu jumlahnya dan membuka dialog
 * Panduan (daftar per fitur); daftarnya tidak lagi ditampilkan di beranda. Tak merender apa pun bila tak ada yang
 * ditawarkan.
 */
export function GuideNotice() {
  const { ready, offers } = useOfferedGuides();
  const [open, setOpen] = useState(false);
  // Ditunda selama dialog/banner onboarding push tampil (spek 4.3), supaya info ini tak menumpuk dengannya.
  const blocked = useBlockingOnboardingActive();
  if (!ready || blocked || offers.length === 0) return null;
  return (
    <>
      <section
        aria-label="Panduan"
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card/40 px-4 py-3"
      >
        <p className="flex items-center gap-2 text-sm">
          <GraduationCap aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          Ada {offers.length} panduan yang belum kamu ikuti.
        </p>
        <Button type="button" size="sm" onClick={() => setOpen(true)}>
          Lihat panduan
        </Button>
      </section>
      {open ? <GuideMenuDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}
