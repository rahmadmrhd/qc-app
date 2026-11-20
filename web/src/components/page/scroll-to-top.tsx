import { ArrowUp } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

/** Jarak gulir (px) sebelum tombol "ke atas" muncul. */
export const SCROLL_TOP_THRESHOLD = 800;

/**
 * Tombol "ke atas" untuk daftar panjang di ponsel: muncul setelah menggulir jauh, kecil dan mengambang di kanan bawah
 * (di atas FAB bila ada, lewat `aboveFab`). Menggulir mulus ke atas halaman; `prefers-reduced-motion` = lompat.
 */
export function ScrollToTop({ aboveFab = false }: { aboveFab?: boolean }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const update = () => setVisible(window.scrollY > SCROLL_TOP_THRESHOLD);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);
  if (!visible) return null;
  return (
    <Button
      type="button"
      size="icon"
      variant="outline"
      aria-label="Ke atas"
      data-slot="scroll-to-top"
      onClick={() => {
        const reduce =
          typeof window.matchMedia === 'function' &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
      }}
      className={
        aboveFab
          ? 'fixed right-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-30 rounded-full bg-background shadow-md'
          : 'fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-30 rounded-full bg-background shadow-md'
      }
    >
      <ArrowUp aria-hidden />
    </Button>
  );
}
