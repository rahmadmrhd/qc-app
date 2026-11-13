import type { LinkProps } from '@tanstack/react-router';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { hasUnsavedChanges } from '@/app/pwa/unsaved-changes';
import { useSidebar } from '@/components/ui/sidebar';
import { useMe } from '@/modules/auth/use-me';
import { useActiveLocations } from '@/modules/location/active-locations-context';
import { stepsFor } from '../../lib/offer';
import type { GuideEntry, GuideStep } from '../../lib/types';
import { useGuideStore } from '../../lib/use-guide-store';
import { TourStepCard } from './tour-step-card';

/** Batas waktu menunggu sebuah target muncul (milidetik) sebelum langkahnya dilewati. */
export const TARGET_WAIT_MS = 3000;

const HIGHLIGHT_PADDING = 6;
const CARD_HEIGHT_GUESS = 260;
const CARD_WIDTH = 336;
const EDGE = 12;

export interface TourOverlayProps {
  entry: GuideEntry;
  /** Menutup tur (selesai maupun dibatalkan). */
  onExit: () => void;
  /** Adegan demo milik entri `tip` untuk langkah ber-`tip` (disambungkan Task 8 ke pemutar Task 7). */
  renderTip?: (tipId: string) => ReactNode;
  targetWaitMs?: number;
}

function selectorOf(target: string): string {
  return `[data-tour="${target.replace(/["\\]/g, '\\$&')}"]`;
}

/** Menunggu elemen `data-tour` muncul (MutationObserver) sampai `ms`; `cancel` membatalkan tanpa menyelesaikan. */
function waitForTarget(target: string, ms: number) {
  let cancel: () => void = () => undefined;
  const promise = new Promise<Element | null>((resolve) => {
    const find = () => document.querySelector(selectorOf(target));
    const hit = find();
    if (hit) {
      resolve(hit);
      return;
    }
    const observer = new MutationObserver(() => {
      const found = find();
      if (found) finish(found);
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-tour'],
    });
    const timer = setTimeout(() => finish(null), ms);
    function finish(value: Element | null) {
      observer.disconnect();
      clearTimeout(timer);
      resolve(value);
    }
    cancel = () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  });
  return { promise, cancel: () => cancel() };
}

/** `useSidebar` melempar di luar `SidebarProvider`; tur tetap jalan tanpa sidebar. */
function useOptionalSidebar(): ReturnType<typeof useSidebar> | null {
  try {
    // biome-ignore lint/correctness/useHookAtTopLevel: useSidebar memanggil useContext tanpa syarat sebelum melempar; urutan hook tetap
    return useSidebar();
  } catch {
    return null;
  }
}

/** Elemen yang menerima ketikan/penggeseran kursor: tombol panah tidak boleh dibajak tur. */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return true;
  return target.isContentEditable === true || target.getAttribute('contenteditable') === 'true';
}

/**
 * Indeks mulai bila ada formulir berdraf: langkah pertama yang berlaku di halaman ini (tanpa `route` lain dan
 * targetnya ada), supaya memulai tur tidak menavigasi keluar dan membuang draf. Tak ada = langkah pertama.
 */
function firstStepOnPage(steps: readonly GuideStep[], pathname: string): number {
  const found = steps.findIndex(
    (step) =>
      (step.route === undefined || step.route === pathname) &&
      document.querySelector(selectorOf(step.target)) !== null,
  );
  return found < 0 ? 0 : found;
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
}

function cardStyle(rect: DOMRect): CSSProperties {
  const width = window.innerWidth;
  const height = window.innerHeight;
  if (width < 640) return { left: EDGE, right: EDGE, bottom: EDGE };
  const left = Math.min(Math.max(rect.left, EDGE), Math.max(EDGE, width - CARD_WIDTH - EDGE));
  if (height - rect.bottom >= CARD_HEIGHT_GUESS) return { left, top: rect.bottom + EDGE };
  if (rect.top >= CARD_HEIGHT_GUESS) return { left, bottom: height - rect.top + EDGE };
  return { left, bottom: EDGE };
}

/**
 * Mesin tur: menyorot elemen asli lewat `data-tour`, berpindah rute lalu menunggu target, dan tidak pernah mengisi
 * atau mengubah apa pun (spek 4.5). Langkah yang `izin`-nya tak terpenuhi dibuang di awal; langkah yang targetnya
 * tak muncul dalam `targetWaitMs` dilewati (tur tidak macet).
 */
export default function TourOverlay({
  entry,
  onExit,
  renderTip,
  targetWaitMs = TARGET_WAIT_MS,
}: TourOverlayProps) {
  const me = useMe();
  const { selectedIds } = useActiveLocations();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { mark } = useGuideStore();
  const sidebar = useOptionalSidebar();

  // Daftar langkah DIBEKUKAN saat tur dimulai: mengganti lokasi aktif atau izin yang berubah di tengah tur tak boleh
  // menggeser indeks (kartu salah teks) atau membuat `tour.active` tanpa kartu.
  const [steps] = useState(() => stepsFor(entry, me, selectedIds));
  // Ada formulir berdraf: mulai dari langkah yang berlaku di halaman ini, bukan menavigasi keluar dan membuang draf.
  const [index, setIndex] = useState(() =>
    hasUnsavedChanges() ? firstStepOnPage(steps, pathname) : 0,
  );
  // Target yang sudah ditemukan, TERIKAT ke indeks langkahnya: begitu `index` berganti, target langkah lama tak lagi
  // berlaku pada render yang sama (tanpa ini kartu langkah baru sempat tampil sebentar di posisi sorotan lama, dan
  // pendengar klik/keyboard langkah lama bisa menangkap peristiwa untuk langkah baru).
  const [located, setLocated] = useState<{ index: number; element: Element } | null>(null);
  const target = located?.index === index ? located.element : null;
  const [rect, setRect] = useState<DOMRect | null>(null);

  // Nilai terbaru untuk efek yang hanya boleh berjalan ulang saat langkah berganti.
  const latest = useRef({ pathname, navigate, sidebar, mark, onExit, steps, entry });
  latest.current = { pathname, navigate, sidebar, mark, onExit, steps, entry };
  const shown = useRef(0);
  const advancedFrom = useRef(-1);
  const finished = useRef(false);
  const openedSidebar = useRef(false);
  const cardRef = useRef<HTMLDivElement>(null);
  // Halaman yang diharapkan selama tur: diubah mesin sendiri (navigasi langkah ber-route) atau dilonggarkan setelah
  // klik pada langkah `click` (klik itu boleh membawa ke halaman lain; `null` = terima perubahan berikutnya).
  // Perpindahan halaman di luar itu = pengguna meninggalkan tur: tur dibatalkan tanpa penanda (spek 4.3).
  const expectedPath = useRef<string | null>(pathname);
  const aborted = useRef(false);
  // Elemen yang fokus sebelum tur dimulai, untuk dikembalikan saat tur ditutup (aksesibilitas keyboard).
  const previousFocus = useRef<Element | null>(
    typeof document === 'undefined' ? null : document.activeElement,
  );

  useEffect(
    () => () => {
      const previous = previousFocus.current;
      const active = document.activeElement;
      const lost = !active || active === document.body;
      if (lost && previous instanceof HTMLElement && previous.isConnected) {
        previous.focus({ preventScroll: true });
      }
    },
    [],
  );

  useEffect(() => {
    if (aborted.current || finished.current) return;
    if (expectedPath.current === null) {
      expectedPath.current = pathname;
      return;
    }
    if (pathname !== expectedPath.current) {
      aborted.current = true;
      finished.current = true;
      latest.current.onExit();
    }
  }, [pathname]);

  const advance = useCallback((from: number) => {
    if (advancedFrom.current >= from) return;
    advancedFrom.current = from;
    setIndex(from + 1);
  }, []);

  // Menjalankan satu langkah: navigasi bila perlu, menunggu target, lalu menampilkannya (atau melewatinya).
  useEffect(() => {
    if (aborted.current) return;
    const step = latest.current.steps[index];
    if (!step) {
      if (finished.current) return;
      finished.current = true;
      const { mark: write, entry: current, onExit: exit } = latest.current;
      // Panduan `diturunkan` (PWA/push) tak punya penanda tersimpan: id-nya bukan bagian `GUIDE_IDS` di server.
      const stored = current.status === 'disimpan' && shown.current > 0;
      const finish = stored ? write(current.id, current.version, current.covers) : null;
      Promise.resolve(finish)
        .catch(() => undefined)
        .finally(exit);
      return;
    }
    setLocated(null);
    setRect(null);
    let cancelled = false;
    let cancelWait: () => void = () => undefined;
    void (async () => {
      const { navigate: go, pathname: here, sidebar: bar } = latest.current;
      if (step.route && here !== step.route) {
        // Ada draf yang belum disimpan: jangan menavigasi keluar (draf akan terbuang); langkah ini dilewati.
        if (hasUnsavedChanges()) {
          advance(index);
          return;
        }
        expectedPath.current = step.route;
        try {
          await go({ to: step.route as LinkProps['to'] });
        } catch {
          // Navigasi ditolak/gagal dimuat: langkah dilewati, tur tidak macet tanpa kartu.
          if (!cancelled) advance(index);
          return;
        }
        if (cancelled || aborted.current) return;
      }
      // Sidebar ponsel dibuka HANYA untuk langkah yang menyorot menu; target lain yang hilang cukup dilewati.
      if (
        step.inSidebar &&
        !document.querySelector(selectorOf(step.target)) &&
        bar?.isMobile &&
        !bar.openMobile
      ) {
        bar.setOpenMobile(true);
        openedSidebar.current = true;
      }
      const wait = waitForTarget(step.target, targetWaitMs);
      cancelWait = wait.cancel;
      const found = await wait.promise;
      if (cancelled || aborted.current) return;
      if (!found) {
        advance(index);
        return;
      }
      // Halaman tujuan klik pengguna sudah terbentuk: mulai dari sini setiap perpindahan lain membatalkan tur.
      if (expectedPath.current === null) expectedPath.current = latest.current.pathname;
      if (openedSidebar.current && !found.closest('[data-sidebar="sidebar"]')) {
        latest.current.sidebar?.setOpenMobile(false);
        openedSidebar.current = false;
      }
      found.scrollIntoView?.({
        block: 'center',
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      });
      shown.current += 1;
      setLocated({ index, element: found });
      setRect(found.getBoundingClientRect());
    })();
    return () => {
      cancelled = true;
      cancelWait();
    };
  }, [index, targetWaitMs, advance]);

  // Menutup sidebar yang kita buka saat tur berakhir.
  useEffect(
    () => () => {
      if (openedSidebar.current) latest.current.sidebar?.setOpenMobile(false);
    },
    [],
  );

  // Menghitung ulang sorotan saat tampilan berubah. Target yang lepas dari DOM (dirender ulang, atau halaman
  // berganti) ditunggu muncul lagi sampai `targetWaitMs`: ketemu = sorotan pindah ke elemen baru, tidak ketemu =
  // dilewati. Bila penyebabnya pengguna pindah halaman, efek pembatalan di atas menutup tur lebih dulu.
  const step = steps[index];
  useEffect(() => {
    if (!target || !step) return;
    let stale = false;
    let relocating = false;
    let cancelWait: () => void = () => undefined;
    const relocate = async () => {
      if (relocating) return;
      relocating = true;
      const wait = waitForTarget(step.target, targetWaitMs);
      cancelWait = wait.cancel;
      const found = await wait.promise;
      if (stale || aborted.current) return;
      if (found) {
        setLocated({ index, element: found });
        setRect(found.getBoundingClientRect());
      } else {
        advance(index);
      }
    };
    const update = () => {
      if (!target.isConnected) {
        void relocate();
        return;
      }
      setRect(target.getBoundingClientRect());
    };
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      stale = true;
      cancelWait();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      observer.disconnect();
    };
  }, [target, step, index, targetWaitMs, advance]);

  // Langkah `click`: maju begitu targetnya diklik (setelah penangan aplikasi sendiri selesai).
  useEffect(() => {
    if (!target || step?.advance !== 'click') return;
    const onClick = (event: MouseEvent) => {
      if (event.target instanceof Node && target.contains(event.target)) {
        // Klik ini boleh membawa ke halaman lain: terima perpindahan berikutnya sebagai bagian dari tur.
        expectedPath.current = null;
        setTimeout(() => advance(index), 0);
      }
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [target, step?.advance, index, advance]);

  // Keyboard: Esc menutup, ArrowRight memajukan langkah `next`.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        latest.current.onExit();
      } else if (
        event.key === 'ArrowRight' &&
        target &&
        step?.advance === 'next' &&
        !isEditable(event.target)
      ) {
        advance(index);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [target, step?.advance, index, advance]);

  // Fokus ke kartu tiap langkah agar pengguna keyboard/pembaca layar langsung berada di penjelasan.
  useEffect(() => {
    if (target) cardRef.current?.focus({ preventScroll: true });
  }, [target]);

  const reduced = prefersReducedMotion();
  const box =
    target && rect
      ? {
          top: rect.top - HIGHLIGHT_PADDING,
          left: rect.left - HIGHLIGHT_PADDING,
          width: rect.width + HIGHLIGHT_PADDING * 2,
          height: rect.height + HIGHLIGHT_PADDING * 2,
        }
      : null;

  return (
    <div
      role="dialog"
      aria-label="Panduan"
      aria-live="polite"
      className="pointer-events-none fixed inset-0 z-[200]"
      // Di ponsel sidebar terbuka sebagai Sheet modal Radix: menekan kartu/penahan tur (di luar kontennya) akan
      // dianggap "klik di luar" dan menutup sidebar yang sedang disorot. Hentikan penjalaran ke pendengar dokumen.
      onPointerDown={(event) => event.stopPropagation()}
    >
      {box && step ? (
        <>
          <div
            data-testid="tour-highlight"
            aria-hidden="true"
            style={{ ...box, boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.55)' }}
            className={`pointer-events-none fixed rounded-lg ring-2 ring-primary ${reduced ? '' : 'transition-all duration-200'} motion-reduce:transition-none`}
          />
          {step.advance === 'next' ? (
            <div
              data-testid="tour-blocker"
              aria-hidden="true"
              style={box}
              className="pointer-events-auto fixed"
            />
          ) : null}
          <TourStepCard
            step={step}
            position={index + 1}
            total={steps.length}
            isLast={index === steps.length - 1}
            tip={step.tip ? renderTip?.(step.tip) : undefined}
            style={cardStyle(rect as DOMRect)}
            cardRef={cardRef}
            onNext={() => advance(index)}
            onClose={() => latest.current.onExit()}
          />
        </>
      ) : null}
    </div>
  );
}
