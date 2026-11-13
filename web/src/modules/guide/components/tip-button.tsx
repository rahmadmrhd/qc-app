import { GUIDE_VERSIONS } from '@shared/guides';
import { Info } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { DemoScene } from '../lib/demo-types';
import { useDemoScenes } from '../lib/use-demo-scenes';
import { useGuideStore } from '../lib/use-guide-store';
import { DemoPlayer } from './demo-player';

/** Jeda sebelum tooltip hover menutup, agar pointer sempat berpindah dari ikon ke isinya. */
const HOVER_CLOSE_MS = 150;

type OpenSource = 'hover' | 'focus' | 'click';

function hasFinePointer(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches;
}

/**
 * Ikon info permanen (spek 4.6) yang membuka demo bergerak. Desktop (`pointer: fine`): hover atau fokus keyboard
 * membuka dan keluar menutup; layar sentuh: ketuk. Ketuk atau Enter pada tooltip yang terbuka lewat hover/fokus
 * mengunci terbuka (tutup dengan Esc atau ketuk di luar). Titik penanda ada sampai tooltip pernah dibuka sekali;
 * pembukaan menulis penanda entri `tip` ke `GuideStore`, dan ikonnya tidak pernah hilang.
 * Adegan dari prop `scenes`, atau dari registri (`registerDemoScenes`/`registerDemoLoader`; dimuat malas saat dibuka).
 */
export function TipButton({
  tipId,
  label,
  scenes,
}: {
  tipId: string;
  label: string;
  scenes?: readonly DemoScene[];
}) {
  const { ready, done, mark } = useGuideStore();
  const [open, setOpen] = useState(false);
  const source = useRef<OpenSource | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const contentRef = useRef<HTMLDivElement>(null);
  const markWritten = useRef(false);
  const suppressFocusOpen = useRef(false);

  // Versi katalog: menaikkannya memunculkan titik lagi (aturan 4.2: versi tersimpan < versi katalog = baru).
  const version = (GUIDE_VERSIONS as Record<string, number>)[tipId] ?? 1;
  const seen = (done.get(tipId) ?? 0) >= version;
  const resolved = useDemoScenes(tipId, { scenes, enabled: open });

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  // Penanda ditulis SEKALI, saat pertama dibuka (juga bila penanda baru termuat sesudahnya). Galat tulis
  // (offline, id tak terdaftar) tidak boleh mengganggu tooltip: titiknya hanya muncul lagi di kunjungan berikut.
  useEffect(() => {
    if (!open || !ready || seen || markWritten.current) return;
    markWritten.current = true;
    mark(tipId, version).catch(() => undefined);
  }, [open, ready, seen, mark, tipId, version]);

  function openWith(next: OpenSource) {
    clearTimeout(closeTimer.current);
    source.current = next;
    setOpen(true);
  }

  function closeIfHovered() {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      if (source.current === 'hover') setOpen(false);
    }, HOVER_CLOSE_MS);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        // Radix hanya menutup lewat Esc atau klik di luar (klik ikon ditangani di bawah).
        if (!next) clearTimeout(closeTimer.current);
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="relative inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
          onPointerEnter={(event) => {
            if (event.pointerType === 'touch' || !hasFinePointer()) return;
            if (!open) openWith('hover');
            else clearTimeout(closeTimer.current);
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === 'touch') return;
            closeIfHovered();
          }}
          onFocus={() => {
            if (!open && !suppressFocusOpen.current && hasFinePointer()) openWith('focus');
          }}
          onBlur={() => {
            if (source.current === 'focus') setOpen(false);
          }}
          onClick={(event) => {
            // Menggantikan toggle bawaan Radix: yang terbuka lewat hover/fokus dikunci, bukan ditutup.
            event.preventDefault();
            if (open && source.current === 'click') {
              setOpen(false);
              return;
            }
            const wasOpen = open;
            openWith('click');
            if (wasOpen) contentRef.current?.focus();
          }}
        >
          <Info className="size-4" aria-hidden />
          {ready && !seen ? (
            <span
              data-slot="tip-dot"
              aria-hidden
              className="absolute top-0 right-0 size-2 rounded-full bg-primary ring-2 ring-background"
            />
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent
        ref={contentRef}
        align="start"
        className="w-80 max-w-[calc(100vw-2rem)]"
        onOpenAutoFocus={(event) => {
          // Dibuka lewat hover/fokus: fokus tetap di ikon, bukan dicuri ke isi tooltip.
          if (source.current !== 'click') event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          // Radix mengembalikan fokus ke ikon saat menutup; itu tidak boleh membuka lagi lewat `onFocus`
          // (Esc pada tooltip yang diketuk akan langsung terbuka kembali), dan tooltip hover tidak mencuri fokus.
          suppressFocusOpen.current = true;
          setTimeout(() => {
            suppressFocusOpen.current = false;
          }, 0);
          if (source.current !== 'click') event.preventDefault();
        }}
        onPointerEnter={() => clearTimeout(closeTimer.current)}
        onPointerLeave={closeIfHovered}
      >
        <p className="font-medium">{label}</p>
        {resolved && resolved.length > 0 ? (
          <DemoPlayer scenes={resolved} />
        ) : (
          <p className="text-muted-foreground">Demonya sedang disiapkan.</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
