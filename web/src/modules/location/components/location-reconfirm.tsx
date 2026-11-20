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
import { activeLocationLabel } from '../active-location-label';
import { useActiveLocations } from '../active-locations-context';
import { LocationSheet } from './location-sheet';

export const LAST_ACTIVE_KEY = 'qc.lastActive';
export const RECONFIRM_AFTER_MS = 4 * 60 * 60 * 1000;

function readLast(): number | null {
  try {
    const raw = localStorage.getItem(LAST_ACTIVE_KEY);
    const value = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function writeLast(at: number): void {
  try {
    localStorage.setItem(LAST_ACTIVE_KEY, String(at));
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

  useEffect(() => {
    if (!relevant) return;
    if (shouldReconfirm(readLast(), Date.now())) setAsking(true);
    else writeLast(Date.now());
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        writeLast(Date.now());
        return;
      }
      if (shouldReconfirm(readLast(), Date.now())) setAsking(true);
      else writeLast(Date.now());
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [relevant]);

  if (!relevant) return null;
  const confirmed = () => {
    writeLast(Date.now());
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
