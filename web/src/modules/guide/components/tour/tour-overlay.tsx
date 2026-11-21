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
import { requestFormTab } from '@/lib/form-tab-request';
import { useMe } from '@/modules/auth/use-me';
import { useActiveLocations } from '@/modules/location/active-locations-context';
import { stepsFor } from '../../lib/offer';
import { useMarkTourActive, useSetTourMenu } from '../../lib/tour-menu';
import { type GuideEntry, type GuideStep, menuOfStep, tabOfStep } from '../../lib/types';
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

/**
 * Membuang langkah yang menu pemicunya tak dirender saat tur dimulai (mis. pemilih lokasi hanya ada bila lokasi > 1),
 * beserta langkah yang menyorot pemicu itu sendiri, supaya "Langkah x dari N" tak melompat dan tur tak menunggu
 * batas waktu untuk elemen yang pasti tak ada.
 */
function withoutMissingMenus(steps: readonly GuideStep[]): GuideStep[] {
  const missing = new Set<string>();
  // Hanya `buka` berupa id menu: `buka: { tab }` diselesaikan saat langkahnya berjalan (formulirnya belum tentu
  // sudah terpasang saat tur dimulai).
  for (const step of steps) {
    const menu = menuOfStep(step);
    if (menu && !document.querySelector(selectorOf(menu))) missing.add(menu);
  }
  if (missing.size === 0) return [...steps];
  return steps.filter((step) => {
    const menu = menuOfStep(step);
    return !(menu && missing.has(menu)) && !missing.has(step.target);
  });
}

/** Lama (ms) kartu contoh terus mengamati targetnya yang bergantung data sebelum menyerah. */
const FALLBACK_WATCH_MS = 60_000;

/** Elemen yang menerima ketikan/penggeseran kursor: tombol panah tidak boleh dibajak tur. */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return true;
  return target.isContentEditable === true || target.getAttribute('contenteditable') === 'true';
}

/**
 * Indeks mulai bila ada formulir berdraf: langkah pertama yang berlaku di halaman ini (tanpa `route` lain dan
 * targetnya ada, atau `langsung` dengan `teksJikaKosong` yang langsung menjadi kartu pengganti di halaman ini),
 * supaya memulai tur tidak menavigasi keluar dan membuang draf. Tak ada = langkah pertama.
 */
function firstStepOnPage(steps: readonly GuideStep[], pathname: string): number {
  const found = steps.findIndex(
    (step) =>
      (step.route === undefined || step.route === pathname) &&
      (document.querySelector(selectorOf(step.target)) !== null ||
        (step.langsung === true && step.teksJikaKosong !== undefined)),
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

/** Kartu langkah cadangan (target bergantung data tak ada): di tengah layar, tanpa sorotan. */
const CENTERED_CARD: CSSProperties = {
  left: '50%',
  top: '50%',
  transform: 'translate(-50%, -50%)',
};

/**
 * Kotak seluruh menu terbuka yang memuat target langkah ber-`buka` (kartu menghindarinya, bukan hanya butir yang
 * disorot, supaya butir menu lain tetap terbaca). `null` bila langkah tak membuka menu atau target di luar menu.
 */
function openMenuRect(target: Element | null, step: GuideStep | undefined): DOMRect | null {
  if (!target || !menuOfStep(step)) return null;
  const menu = target.closest(
    '[role="menu"], [data-radix-popper-content-wrapper], [role="dialog"]',
  );
  return menu ? menu.getBoundingClientRect() : null;
}

/** Ruang di bawah target langkah `wait` yang dipakai daftar saran saat dibuka pengguna (kartu menghindarinya). */
const WAIT_LIST_ROOM = 320;

/**
 * Langkah `wait`: pengguna membuka daftar saran di bawah target, jadi kartu menghindari target beserta ruang daftar
 * itu (kartu pindah ke atas/samping). `null` untuk langkah lain.
 */
function waitListRect(rect: DOMRect, step: GuideStep | undefined) {
  if (step?.advance !== 'wait') return null;
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height + WAIT_LIST_ROOM,
  };
}

interface CardSize {
  width: number;
  height: number;
}

/** Luas irisan dua persegi panjang (0 bila tak beririsan). */
function overlapArea(
  a: { left: number; top: number; width: number; height: number },
  b: { left: number; top: number; width: number; height: number },
): number {
  const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Letak kartu dari ukuran aslinya (bukan tebakan): kandidat bawah, atas, kiri, dan kanan sorotan, masing-masing
 * dijepit ke dalam layar; yang paling sedikit menutupi sorotan menang (kandidat lebih awal bila seri). Kartu yang
 * tumbuh setelah demo termuat tak lagi keluar layar, dan isi menu terbuka tak tertutup bila ada ruang di sisinya.
 */
function cardStyle(
  rect: DOMRect,
  size: CardSize,
  avoid: { left: number; top: number; width: number; height: number } | null = null,
  dock = false,
): CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (vw < 640) return { left: EDGE, right: EDGE, bottom: EDGE };
  const maxLeft = Math.max(EDGE, vw - size.width - EDGE);
  const maxTop = Math.max(EDGE, vh - size.height - EDGE);
  const clampX = (x: number) => Math.min(Math.max(x, EDGE), maxLeft);
  const clampY = (y: number) => Math.min(Math.max(y, EDGE), maxTop);
  const below = { left: clampX(rect.left), top: clampY(rect.bottom + EDGE) };
  const lit = {
    left: rect.left - HIGHLIGHT_PADDING,
    top: rect.top - HIGHLIGHT_PADDING,
    width: rect.width + HIGHLIGHT_PADDING * 2,
    height: rect.height + HIGHLIGHT_PADDING * 2,
  };
  // Langkah `wait`: pengguna bekerja di dalam target, jadi kartu parkir di pojok kanan bawah layar (jauh dari
  // kolom ketik dan awal daftar saran) selama tak menimpa target; bila menimpa, jatuh ke penempatan biasa.
  const corner = { left: maxLeft, top: maxTop };
  if (dock && overlapArea({ ...corner, ...size }, lit) === 0) return corner;
  const candidates = [
    below,
    { left: clampX(rect.left), top: clampY(rect.top - size.height - EDGE) },
    { left: clampX(rect.left - HIGHLIGHT_PADDING - EDGE - size.width), top: clampY(rect.top) },
    { left: clampX(rect.right + HIGHLIGHT_PADDING + EDGE), top: clampY(rect.top) },
  ];
  let best = below;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const box = { ...candidate, ...size };
    const score = overlapArea(box, lit) + (avoid ? overlapArea(box, avoid) : 0);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function sameRect(a: DOMRect | null, b: DOMRect): boolean {
  return (
    a !== null &&
    a.top === b.top &&
    a.left === b.left &&
    a.width === b.width &&
    a.height === b.height
  );
}

/** Menunggu `count` bingkai animasi (menu Radix baru terposisi setelah terpasang); `setTimeout` bila tak ada rAF. */
/** Elemen (atau leluhurnya) bertanda `hidden`: panel tab form yang belum aktif. Murni atribut: tanpa tata letak (jsdom). */
function isHiddenByAttribute(element: Element): boolean {
  return element.closest('[hidden]') !== null;
}

/** Menunggu beberapa bingkai sampai `element` tak lagi tersembunyi; false bila tetap tersembunyi. */
async function waitUntilVisible(element: Element, frames = 4): Promise<boolean> {
  for (let i = 0; i < frames; i += 1) {
    if (!isHiddenByAttribute(element)) return true;
    await nextFrames(1);
  }
  return !isHiddenByAttribute(element);
}

function nextFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== 'function') {
      setTimeout(resolve, 32 * count);
      return;
    }
    let left = count;
    const tick = () => {
      left -= 1;
      if (left <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
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
  const [steps] = useState(() => withoutMissingMenus(stepsFor(entry, me, selectedIds)));
  useMarkTourActive();
  // Target bergantung data yang sudah terbukti kosong pada tur ini: langkah berikutnya bertarget sama langsung jatuh
  // ke kartu contoh tanpa menunggu batas waktu lagi.
  const emptyTargets = useRef(new Set<string>());
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
  // Langkah ber-`teksJikaKosong` yang targetnya tak muncul: tampil sebagai kartu contoh di tengah layar.
  const [fallback, setFallback] = useState<number | null>(null);
  const inFallback = fallback === index;
  const setMenu = useSetTourMenu();

  // Nilai terbaru untuk efek yang hanya boleh berjalan ulang saat langkah berganti.
  const latest = useRef({ pathname, navigate, sidebar, mark, onExit, steps, entry, setMenu });
  latest.current = { pathname, navigate, sidebar, mark, onExit, steps, entry, setMenu };
  const shown = useRef(0);
  const advancedFrom = useRef(-1);
  const finished = useRef(false);
  const openedSidebar = useRef(false);
  const cardRef = useRef<HTMLDivElement>(null);
  // Ukuran kartu yang sebenarnya (tumbuh saat demo dimuat malas): dipantau supaya letaknya dihitung ulang.
  const [cardSize, setCardSize] = useState<CardSize>({
    width: CARD_WIDTH,
    height: CARD_HEIGHT_GUESS,
  });
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

  // Hanya PERUBAHAN `pathname` yang diperiksa: efek yang dijalankan ulang tanpa perubahan (StrictMode dev memanggil
  // efek dua kali) akan membandingkan `pathname` render lama dengan `expectedPath` yang sudah diset mesin untuk
  // langkah berrute dan keliru menutup tur yang baru dimulai dari halaman lain.
  const seenPath = useRef(pathname);
  useEffect(() => {
    if (aborted.current || finished.current) return;
    const changed = seenPath.current !== pathname;
    seenPath.current = pathname;
    if (!changed) return;
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
      latest.current.setMenu(null);
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
    // Menu yang diminta langkah ini dibuka sekarang (murni UI), menu langkah lama ditutup. Pemicu yang tak ada di
    // layar (mis. pemilih lokasi untuk satu lokasi) = langkah dilewati segera, tanpa menunggu batas waktu.
    const stepMenu = menuOfStep(step);
    const stepTab = tabOfStep(step);
    if (stepMenu && !document.querySelector(selectorOf(stepMenu))) {
      latest.current.setMenu(null);
      advance(index);
      return;
    }
    latest.current.setMenu(stepMenu ?? null);
    setLocated(null);
    setRect(null);
    setFallback(null);
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
      // Target yang sudah terbukti kosong tak ditunggu lagi (langkah data-bergantung berturut-turut tak membeku 3 dtk).
      // `langsung`: halaman sudah settle (mis. sesudah langkah `wait`), jadi target yang tak ada tak perlu ditunggu:
      // dilewati seketika (tanpa `teksJikaKosong`) atau jatuh ke kartu pengganti (dengan `teksJikaKosong`).
      // Target di tab `ViewPage` yang belum ter-mount (hanya tab aktif dirender): minta tabnya dibuka lebih dulu.
      if (stepTab !== undefined && !document.querySelector(selectorOf(step.target))) {
        requestFormTab(stepTab);
      }
      const knownEmpty =
        step.langsung === true ||
        (step.teksJikaKosong !== undefined && emptyTargets.current.has(step.target));
      const wait = knownEmpty
        ? { promise: Promise.resolve(document.querySelector(selectorOf(step.target))), cancel() {} }
        : waitForTarget(step.target, targetWaitMs);
      cancelWait = wait.cancel;
      let found = await wait.promise;
      if (cancelled || aborted.current) return;
      // Target di panel tab tersembunyi (`FormTabs` mempertahankan semua panel dengan `hidden`): buka tabnya lebih
      // dulu bila langkah memintanya, lalu pastikan target benar-benar terlihat sebelum disorot.
      if (found && stepTab !== undefined && isHiddenByAttribute(found)) {
        requestFormTab(stepTab);
        found = (await waitUntilVisible(found)) ? found : null;
        if (cancelled || aborted.current) return;
      } else if (found && isHiddenByAttribute(found)) {
        found = (await waitUntilVisible(found)) ? found : null;
        if (cancelled || aborted.current) return;
      }
      if (!found) {
        if (step.teksJikaKosong === undefined) {
          advance(index);
          return;
        }
        // Target bergantung data tak ada: kartu contoh di tengah layar (tetap terhitung sebagai langkah).
        emptyTargets.current.add(step.target);
        if (expectedPath.current === null) expectedPath.current = latest.current.pathname;
        shown.current += 1;
        setFallback(index);
        return;
      }
      emptyTargets.current.delete(step.target);
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
      if (stepMenu) {
        // Isi menu Radix baru terposisi beberapa bingkai setelah terpasang: sorotan jangan diukur sebelum itu.
        await nextFrames(2);
        if (cancelled || aborted.current) return;
      }
      shown.current += 1;
      setLocated({ index, element: found });
      setRect(found.getBoundingClientRect());
    })();
    return () => {
      cancelled = true;
      cancelWait();
    };
  }, [index, targetWaitMs, advance]);

  // Menutup sidebar dan menu yang kita buka saat tur berakhir (selesai, dibatalkan, atau Esc).
  useEffect(
    () => () => {
      if (openedSidebar.current) latest.current.sidebar?.setOpenMobile(false);
      latest.current.setMenu(null);
    },
    [],
  );

  // Menghitung ulang sorotan saat tampilan berubah. Target yang lepas dari DOM (dirender ulang, atau halaman
  // berganti) ditunggu muncul lagi sampai `targetWaitMs`: ketemu = sorotan pindah ke elemen baru, tidak ketemu =
  // dilewati. Bila penyebabnya pengguna pindah halaman, efek pembatalan di atas menutup tur lebih dulu.
  const step = steps[index];

  // Langkah `wait`: tombol Lanjut aktif selama elemen `waitFor` ada (muncul begitu pengguna selesai mengerjakan
  // targetnya); hilang lagi (mis. item dibatalkan) = nonaktif lagi.
  const gateTarget = step?.advance === 'wait' ? step.waitFor : undefined;
  const [gateOpen, setGateOpen] = useState(false);
  useEffect(() => {
    if (gateTarget === undefined) return;
    const check = () => document.querySelector(selectorOf(gateTarget)) !== null;
    setGateOpen(check());
    const observer = new MutationObserver(() => setGateOpen(check()));
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-tour'],
    });
    return () => observer.disconnect();
  }, [gateTarget]);

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
      const next = target.getBoundingClientRect();
      setRect((current) => (sameRect(current, next) ? current : next));
    };
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    const observer = new MutationObserver(update);
    // `style`: pembungkus popper Radix berpindah lewat atribut style saat menu terposisi/diposisikan ulang.
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style'],
    });
    return () => {
      stale = true;
      cancelWait();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      observer.disconnect();
    };
  }, [target, step, index, targetWaitMs, advance]);

  // Kartu contoh bersifat sementara: papan yang baru termuat belakangan (jaringan lambat) tetap disorot begitu
  // targetnya muncul, tidak terjebak pada teks "masih kosong".
  useEffect(() => {
    if (!inFallback || !step) return;
    const wait = waitForTarget(step.target, FALLBACK_WATCH_MS);
    let stale = false;
    void wait.promise.then((found) => {
      if (stale || !found || aborted.current) return;
      emptyTargets.current.delete(step.target);
      setFallback(null);
      setLocated({ index, element: found });
      setRect(found.getBoundingClientRect());
    });
    return () => {
      stale = true;
      wait.cancel();
    };
  }, [inFallback, step, index]);

  // Menu Radix masuk dengan animasi zoom: ukur sekali lagi sesudah animasinya selesai (pengukuran 2 bingkai pertama
  // bisa lebih kecil beberapa piksel dan atribut `style` tak berubah sehingga pengamat tak terpicu).
  useEffect(() => {
    if (!target || !menuOfStep(step)) return;
    const timer = setTimeout(() => {
      if (!target.isConnected) return;
      const next = target.getBoundingClientRect();
      setRect((current) => (sameRect(current, next) ? current : next));
    }, 300);
    return () => clearTimeout(timer);
  }, [target, step]);

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
        (target || inFallback) &&
        (step?.advance === 'next' || (step?.advance === 'wait' && gateOpen) || inFallback) &&
        !isEditable(event.target)
      ) {
        advance(index);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [target, inFallback, step?.advance, gateOpen, index, advance]);

  // Mengukur kartu (dan mengukur ulang saat isinya tumbuh). Tanpa ResizeObserver/tata letak (jsdom) ukuran tebakan dipakai.
  useEffect(() => {
    const card = cardRef.current;
    if (!card || (!target && !inFallback) || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const { width, height } = card.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      setCardSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    return () => observer.disconnect();
  }, [target, inFallback]);

  // Fokus ke kartu tiap langkah agar pengguna keyboard/pembaca layar langsung berada di penjelasan.
  useEffect(() => {
    if (target || inFallback) cardRef.current?.focus({ preventScroll: true });
  }, [target, inFallback]);

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
            // Langkah `wait`: pengguna bekerja di dalam target (daftar saran terbuka di portal), jadi halaman tak
            // digelapkan; hanya bingkai penyorot.
            style={
              step.advance === 'wait'
                ? box
                : { ...box, boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.55)' }
            }
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
            style={cardStyle(
              rect as DOMRect,
              cardSize,
              openMenuRect(target, step) ?? waitListRect(rect as DOMRect, step),
              step.advance === 'wait',
            )}
            cardRef={cardRef}
            gateOpen={gateOpen}
            onNext={() => advance(index)}
            onClose={() => latest.current.onExit()}
          />
        </>
      ) : inFallback && step ? (
        <TourStepCard
          step={{ ...step, text: step.teksJikaKosong ?? step.text, advance: 'next' }}
          position={index + 1}
          total={steps.length}
          isLast={index === steps.length - 1}
          tip={step.tip ? renderTip?.(step.tip) : undefined}
          style={CENTERED_CARD}
          cardRef={cardRef}
          onNext={() => advance(index)}
          onClose={() => latest.current.onExit()}
        />
      ) : null}
    </div>
  );
}
