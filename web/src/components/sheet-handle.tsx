import { cn } from 'cn';
import { type RefObject, useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';

/** Seretan dihitung sebagai gestur bila melewati jarak ini (px), atau cukup cepat (px/ms) dan melewati jarak minimum. */
const DRAG_DISTANCE = 48;
const DRAG_MIN_FOR_VELOCITY = 16;
const DRAG_VELOCITY = 0.5;
/** Di bawah jarak ini pelepasan dianggap ketukan (membalik collapsed/expanded). */
const TAP_DISTANCE = 6;
const ANIMATION_MS = 240;
const ANIMATION_EASE = 'cubic-bezier(0.22, 0.9, 0.3, 1)';

/** Properti inline yang disentuh gestur dan animasi; disimpan lalu dipulihkan agar `style` milik React tak rusak. */
const TOUCHED = [
  'top',
  'bottom',
  'left',
  'width',
  'height',
  'maxHeight',
  'transform',
  'transition',
] as const;
type Saved = Record<(typeof TOUCHED)[number], string>;

function saveStyle(node: HTMLElement): Saved {
  const saved = {} as Saved;
  for (const key of TOUCHED) saved[key] = node.style[key];
  return saved;
}

function restoreStyle(node: HTMLElement, saved: Saved) {
  for (const key of TOUCHED) node.style[key] = saved[key];
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Menganimasikan lembar dari kotak `from` (posisi terlihat sebelum perubahan) ke kotak akhirnya (posisi sesudah React
 * menerapkan keadaan baru), tanpa bergantung pada cara lembar dipasang (`bottom` + tinggi otomatis seperti
 * `ui/sheet.tsx`, atau `top`/`bottom` + tinggi tetap seperti daftar combobox). Tinggi `auto` ↔ `100dvh` tak dapat
 * ditransisikan CSS, jadi selama animasi `top`/`left`/`width`/`height` dipaku dalam px, lalu `style` dikembalikan persis
 * seperti yang ditetapkan React. Mengembalikan fungsi yang menyelesaikan animasi seketika.
 */
function animateFrom(node: HTMLElement, from: DOMRect): (() => void) | null {
  if (prefersReducedMotion()) return null;
  const settled = saveStyle(node);
  const to = node.getBoundingClientRect();
  const moved = (['top', 'left', 'width', 'height'] as const).some(
    (key) => Math.abs(from[key] - to[key]) >= 1,
  );
  if (!moved) return null;
  const { style } = node;
  style.transition = 'none';
  style.bottom = 'auto';
  style.maxHeight = 'none';
  style.top = `${from.top}px`;
  style.left = `${from.left}px`;
  style.width = `${from.width}px`;
  style.height = `${from.height}px`;
  // Paksa layout agar kotak awal tercatat sebelum transisi dimulai.
  void node.offsetHeight;
  style.transition = ['top', 'left', 'width', 'height']
    .map((property) => `${property} ${ANIMATION_MS}ms ${ANIMATION_EASE}`)
    .join(', ');
  style.top = `${to.top}px`;
  style.left = `${to.left}px`;
  style.width = `${to.width}px`;
  style.height = `${to.height}px`;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    node.removeEventListener('transitionend', onEnd);
    restoreStyle(node, settled);
  };
  const onEnd = (event: TransitionEvent) => {
    if (event.target === node && event.propertyName === 'height') finish();
  };
  const timer = setTimeout(finish, ANIMATION_MS + 80);
  node.addEventListener('transitionend', onEnd);
  return finish;
}

/**
 * Pegangan lembar bawah (B2d), SATU-SATUNYA implementasi gestur untuk semua lembar bawah (`ui/sheet.tsx` dan mode
 * `sheet` combobox): seret ke atas = layar penuh (expanded), seret ke bawah dari layar penuh = tinggi awal (collapsed),
 * seret ke bawah dari tinggi awal = `onClose`; ketukan, Enter, atau Spasi membalik collapsed/expanded, panah atas atau
 * bawah mengatur keadaannya. Ditangani dengan pointer events. Mulus: seret ke atas MEMBESARKAN lembar mengikuti jari
 * (tepi bawah tetap, tanpa celah di bawahnya), seret ke bawah menggeser lembar; saat dilepas, juga saat ketukan atau
 * keyboard, lembar beranimasi dari posisi terakhirnya ke keadaan tujuan (`animateFrom`) alih-alih melompat. Semuanya
 * lewat `style` langsung (tanpa render ulang selama menyeret). `keepFocus` = jangan memindah fokus dari elemen lain
 * saat disentuh (mis. kolom input combobox yang akan menutup daftarnya bila kehilangan fokus) dan tak dapat difokus
 * lewat Tab.
 */
export function SheetHandle({
  expanded,
  onExpandedChange,
  onClose,
  targetRef,
  keepFocus,
  decorative,
  className,
}: {
  expanded: boolean;
  onExpandedChange: (next: boolean) => void;
  onClose?: (() => void) | null | undefined;
  targetRef: RefObject<HTMLElement | null>;
  keepFocus?: boolean;
  /** Sembunyikan dari teknologi bantu (mis. di dalam `listbox`, yang hanya boleh berisi opsi). */
  decorative?: boolean;
  className?: string;
}) {
  const start = useRef<{
    y: number;
    at: number;
    id: number;
    rect: DOMRect;
    saved: Saved;
  } | null>(null);
  // Seretan baru saja selesai: `click` yang menyusul pelepasan jari tidak boleh dihitung sebagai ketukan.
  const dragged = useRef(false);
  // Animasi yang sedang berjalan: diselesaikan seketika bila gestur baru dimulai atau lembar dilepas.
  const running = useRef<(() => void) | null>(null);
  useEffect(() => () => running.current?.(), []);

  const settle = (node: HTMLElement | null, from: DOMRect | null) => {
    running.current = node && from ? animateFrom(node, from) : null;
  };

  /** Mengganti keadaan (sinkron, agar tata letak akhir terukur) lalu menganimasikan dari kotak terlihat sebelumnya. */
  const change = (next: boolean, from?: DOMRect) => {
    const node = targetRef.current;
    running.current?.();
    const origin = from ?? node?.getBoundingClientRect() ?? null;
    flushSync(() => onExpandedChange(next));
    settle(node, origin);
  };

  const follow = (node: HTMLElement, origin: NonNullable<typeof start.current>, dy: number) => {
    restoreStyle(node, origin.saved);
    node.style.transition = 'none';
    if (dy < 0 && !expanded) {
      // Membesar ke atas: tepi bawah tetap, tepi atas mengikuti jari sampai atas layar.
      const grow = Math.min(-dy, Math.max(origin.rect.top, 0));
      node.style.bottom = 'auto';
      node.style.maxHeight = 'none';
      node.style.top = `${origin.rect.top - grow}px`;
      node.style.height = `${origin.rect.height + grow}px`;
    } else if (dy > 0) {
      node.style.transform = `translateY(${dy}px)`;
    }
  };

  const finish = (clientY: number, cancelled: boolean) => {
    const origin = start.current;
    start.current = null;
    const node = targetRef.current;
    // Posisi terlihat saat jari dilepas (termasuk geseran/pembesaran): titik awal animasi.
    const from = node?.getBoundingClientRect() ?? null;
    if (node && origin) restoreStyle(node, origin.saved);
    if (!origin || cancelled) {
      settle(node, from);
      return;
    }
    const dy = clientY - origin.y;
    if (Math.abs(dy) >= TAP_DISTANCE) {
      dragged.current = true;
      setTimeout(() => {
        dragged.current = false;
      }, 50);
    }
    const elapsed = Math.max(1, performance.now() - origin.at);
    const velocity = Math.abs(dy) / elapsed;
    const passed =
      Math.abs(dy) >= DRAG_DISTANCE ||
      (Math.abs(dy) >= DRAG_MIN_FOR_VELOCITY && velocity >= DRAG_VELOCITY);
    if (!passed) {
      // Kembali ke posisi semula dengan mulus.
      settle(node, from);
      return;
    }
    if (dy < 0) {
      if (!expanded) change(true, from ?? undefined);
      else settle(node, from);
    } else if (expanded) {
      change(false, from ?? undefined);
    } else {
      onClose?.();
    }
  };

  return (
    <button
      type="button"
      tabIndex={keepFocus ? -1 : 0}
      aria-label={expanded ? 'Kecilkan lembar' : 'Lebarkan lembar'}
      aria-expanded={decorative ? undefined : expanded}
      aria-hidden={decorative || undefined}
      data-slot="sheet-handle"
      className={cn(
        '-mb-3 flex w-full shrink-0 cursor-grab items-center justify-center py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:cursor-grabbing',
        className,
      )}
      style={{ touchAction: 'none' }}
      onMouseDown={keepFocus ? (event) => event.preventDefault() : undefined}
      onPointerDown={(event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        running.current?.();
        running.current = null;
        const node = targetRef.current;
        if (node) {
          start.current = {
            y: event.clientY,
            at: performance.now(),
            id: event.pointerId,
            rect: node.getBoundingClientRect(),
            saved: saveStyle(node),
          };
        }
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        const origin = start.current;
        const node = targetRef.current;
        if (!origin || !node || origin.id !== event.pointerId) return;
        follow(node, origin, event.clientY - origin.y);
      }}
      onPointerUp={(event) => finish(event.clientY, false)}
      onPointerCancel={(event) => finish(event.clientY, true)}
      onClick={() => {
        if (dragged.current) {
          dragged.current = false;
          return;
        }
        // Enter dan Spasi pada <button> menghasilkan `click`, jadi keyboard setara dengan ketukan.
        change(!expanded);
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowUp' && !expanded) {
          event.preventDefault();
          change(true);
        } else if (event.key === 'ArrowDown' && expanded) {
          event.preventDefault();
          change(false);
        }
      }}
    >
      <span aria-hidden className="h-1.5 w-10 rounded-full bg-muted-foreground/30" />
    </button>
  );
}
