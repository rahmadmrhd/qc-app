import { useEffect, useRef, useState } from 'react';
import { closeOverlay, openOverlay } from '@/lib/nav-stack';
import { useIsMobile } from './use-mobile';

/**
 * Back menutup overlay (spek redesain butir 41b): di ponsel, selama `open` true hook mendaftarkan satu entri riwayat
 * lewat pengelola `lib/nav-stack` (back dari pengguna memanggil `onClose`; ditutup lewat UI melepas entri tanpa
 * double-pop; `onClose` yang ditolak memasang entri lagi). Gerbang ponsel = `useIsMobile` (viewport < 768), sama
 * dengan panel menu dan header. Desktop tidak berubah sama sekali. `enabled: false` untuk dialog yang dibuka oleh
 * penjaga keluar halaman (blocker), yang tidak boleh menyisipkan entri riwayat.
 */
export function useBackToClose(open: boolean, onClose: () => void, enabled = true): void {
  const phone = useIsMobile();
  const active = open && phone && enabled;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    if (!active) return;
    const handle = openOverlay(
      () => onCloseRef.current(),
      () => openRef.current,
    );
    return () => closeOverlay(handle);
  }, [active]);
}

interface RootOpenProps {
  open?: boolean | undefined;
  defaultOpen?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  /** `false` = tanpa entri riwayat (dialog penjaga keluar halaman). */
  backToClose?: boolean | undefined;
}

/**
 * Untuk akar Dialog/AlertDialog/Sheet: menyatukan mode terkendali dan tak terkendali menjadi `open` + `onOpenChange`
 * terkendali, dan memasang `useBackToClose`.
 */
export function useBackToCloseRoot({ open, defaultOpen, onOpenChange, backToClose }: RootOpenProps): {
  open: boolean;
  onOpenChange: (open: boolean) => void;
} {
  const [inner, setInner] = useState(defaultOpen ?? false);
  const controlled = open !== undefined;
  const isOpen = controlled ? open : inner;
  const change = (next: boolean) => {
    if (!controlled) setInner(next);
    onOpenChange?.(next);
  };
  useBackToClose(isOpen, () => change(false), backToClose !== false);
  return { open: isOpen, onOpenChange: change };
}
