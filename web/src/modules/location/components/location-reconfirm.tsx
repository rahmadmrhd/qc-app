import { useEffect, useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useIsMobile } from '@/hooks/use-mobile';
import { useMe } from '@/modules/auth/use-me';
import { activeLocationLabel } from '../active-location-label';
import { useActiveLocations } from '../active-locations-context';
import { lastActiveKey } from '../last-active';
import { LocationSheet } from './location-sheet';

export const RECONFIRM_AFTER_MS = 4 * 60 * 60 * 1000;

function readLast(key: string): number | null {
  try {
    const raw = localStorage.getItem(key);
    const value = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function writeLast(key: string, at: number): void {
  try {
    localStorage.setItem(key, String(at));
  } catch {
    // Penyimpanan diblokir: tanpa penanda, dialog tak pernah muncul (aman).
  }
}

/** True bila aplikasi tidak aktif sejak `last` selama minimal 4 jam; tanpa penanda (login pertama) = false. */
export function shouldReconfirm(last: number | null, now: number): boolean {
  return last !== null && now - last >= RECONFIRM_AFTER_MS;
}

/**
 * Ponsel (butir 42f): saat aplikasi dibuka kembali setelah tidak aktif >= 4 jam, tanyakan apakah lokasi aktif masih
 * benar. Penanda waktu di localStorage (diperbarui saat tab disembunyikan dan saat dibuka); tanpa penanda (login
 * pertama) tidak ada dialog. Hanya bila ada lebih dari satu lokasi yang bisa dipilih.
 */
export function LocationReconfirm() {
  const phone = useIsMobile();
  const { available, selectedIds } = useActiveLocations();
  const [asking, setAsking] = useState(false);
  const [picking, setPicking] = useState(false);
  const relevant = phone && available.length > 1;
  const key = lastActiveKey(useMe().email);

  useEffect(() => {
    if (!relevant) return;
    const touch = () => writeLast(key, Date.now());
    if (shouldReconfirm(readLast(key), Date.now())) setAsking(true);
    else touch();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        touch();
        return;
      }
      if (shouldReconfirm(readLast(key), Date.now())) setAsking(true);
      else touch();
    };
    // Interaksi memperbarui penanda (maks. 1 kali per menit): tab yang tersembunyi lama tak memicu dialog bila pengguna
    // sebenarnya aktif di tab lain (penanda dibagi antar tab).
    let lastTouch = 0;
    const onInteract = () => {
      const now = Date.now();
      if (now - lastTouch < 60_000) return;
      lastTouch = now;
      if (!asking) writeLast(key, now);
    };
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('pointerdown', onInteract, { passive: true });
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('pointerdown', onInteract);
    };
  }, [relevant, key, asking]);

  if (!relevant) return null;
  const confirmed = () => {
    writeLast(key, Date.now());
    setAsking(false);
  };
  return (
    <>
      <AlertDialog open={asking} onOpenChange={(next) => (next ? undefined : confirmed())}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Lokasi aktif: {activeLocationLabel(available, selectedIds)}
            </AlertDialogTitle>
            <AlertDialogDescription>Apakah lokasi ini masih benar?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                confirmed();
                setPicking(true);
              }}
            >
              Ganti
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmed}>Sudah benar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <LocationSheet open={picking} onOpenChange={setPicking} />
    </>
  );
}
