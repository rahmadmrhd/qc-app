import { useEffect, useRef, useState } from 'react';
import { overlayDepth, pushOverlayEntry } from '@/lib/nav-stack';
import { useIsDesktop } from './use-is-desktop';

/**
 * Back menutup overlay (spek redesain butir 41b): di ponsel, selama `open` true hook menyisipkan satu entri riwayat;
 * back (popstate) memanggil `onClose`. Ditutup lewat UI = entri itu dibuang (`history.back()`), tanpa entri sisa dan
 * tanpa double-pop (penutupan karena back tidak membuang lagi). Bila `onClose` ditolak pemanggil (mis. form kotor
 * menahan penutupan) dan overlay masih terbuka, entri dipasang ulang agar back berikutnya tetap menutup overlay.
 * Desktop (`useIsDesktop` true) tidak berubah sama sekali.
 */
export function useBackToClose(open: boolean, onClose: () => void): void {
  const desktop = useIsDesktop();
  const active = open && !desktop;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    if (!active) return;
    let depth = pushOverlayEntry();
    let popped = false;
    const onPop = () => {
      if (popped || overlayDepth() >= depth) return;
      popped = true;
      onCloseRef.current();
      // Overlay ditahan terbuka oleh pemanggil: pasang entri lagi agar back berikutnya menutupnya.
      setTimeout(() => {
        if (!openRef.current) return;
        depth = pushOverlayEntry();
        popped = false;
      }, 30);
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      // Ditutup lewat UI: buang entri milik kita bila masih paling atas.
      if (!popped && overlayDepth() >= depth) window.history.back();
    };
  }, [active]);
}

interface RootOpenProps {
  open?: boolean | undefined;
  defaultOpen?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
}

/**
 * Untuk akar Dialog/AlertDialog/Sheet: menyatukan mode terkendali dan tak terkendali menjadi `open` + `onOpenChange`
 * terkendali, dan memasang `useBackToClose`.
 */
export function useBackToCloseRoot({ open, defaultOpen, onOpenChange }: RootOpenProps): {
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
  useBackToClose(isOpen, () => change(false));
  return { open: isOpen, onOpenChange: change };
}
