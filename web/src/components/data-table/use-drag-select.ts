import { useCallback, useEffect, useRef, useState } from 'react';
import { rangeBetween } from './selection-range';
import type { RowSelection } from './use-row-selection';

/** Jarak dari tepi area gulir (px) tempat gulir otomatis mulai bekerja. */
const EDGE_PX = 56;
/** Kecepatan gulir otomatis maksimum (px per frame), di tepi paling ujung. */
const MAX_STEP_PX = 18;
/** Jari harus bergeser sejauh ini (px) dari titik awal sebelum seret dianggap nyata (gulir otomatis baru boleh jalan). */
export const DRAG_TOLERANCE_PX = 8;

export interface DragPointer {
  x: number;
  y: number;
  id: number;
}

function idAt(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-select-id]');
  return el?.getAttribute('data-select-id') ?? null;
}

function findElement(id: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>('[data-select-id]')) {
    if (el.getAttribute('data-select-id') === id) return el;
  }
  return null;
}

/** Ancestor yang menggulir vertikal; `null` = halaman (window). */
function scrollParentOf(el: HTMLElement | null): HTMLElement | null {
  for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') return node;
  }
  return null;
}

/**
 * Pilih tarik (ponsel): dari kartu awal ke kartu di bawah jari, pilihan = snapshot awal ditambah (`on`) atau dikurangi
 * (`!on`) rentang awal..target. Menyeret kembali melepas yang terlewati. Dekat tepi area gulir, daftar menggulir
 * otomatis selama jari ditahan. `selection` boleh undefined (tanpa pilihan = tak melakukan apa pun).
 */
export function useDragSelect(args: {
  selection: RowSelection | undefined;
  ids: readonly string[];
  /** false = seret mati total: sesi diakhiri dan pendengar sentuh dicabut. */
  active?: boolean;
}) {
  const argsRef = useRef(args);
  argsRef.current = args;
  const [dragging, setDragging] = useState(false);
  const live = useRef(false);
  const session = useRef<{
    startId: string;
    on: boolean;
    snapshot: ReadonlySet<string>;
    applied: ReadonlySet<string>;
    lastTarget: string | null;
    scroller: HTMLElement | null;
    startEl: HTMLElement | null;
    origin: { x: number; y: number };
    moved: boolean;
  } | null>(null);
  const last = useRef({ x: 0, y: 0 });
  const raf = useRef<number | null>(null);
  // Rujukan stabil ke `end` agar pendengar window dapat dicabut persis yang dipasang.
  const endRef = useRef<() => void>(() => {});

  // Pendengar touchmove tak-pasif selama seret diizinkan (lihat efek di bawah): hanya dibatalkan saat sesi hidup.
  // touchstart sengaja tak didengar (membatalkannya menghilangkan `click` kompatibilitas: kotak centang tak bisa diketuk).
  const touchBlock = useRef((event: TouchEvent) => {
    if (live.current && event.cancelable) event.preventDefault();
  });

  const recompute = useCallback((x: number, y: number) => {
    const s = session.current;
    const { selection, ids } = argsRef.current;
    if (!s || !selection) return;
    const target = idAt(x, y);
    if (target === null || target === s.lastTarget) return;
    // Baru menyentuh kartu awal sendiri: belum ada yang diterapkan (ketukan biasa tetap mengubah satu pilihan).
    if (target === s.startId && s.lastTarget === null) {
      s.lastTarget = target;
      return;
    }
    s.moved = true;
    const range = rangeBetween(ids, s.startId, target);
    if (range.length === 0) return;
    s.lastTarget = target;
    const desired = new Set(s.snapshot);
    for (const id of range) {
      if (s.on) desired.add(id);
      else desired.delete(id);
    }
    const add = [...desired].filter((id) => !s.applied.has(id));
    const drop = [...s.applied].filter((id) => !desired.has(id));
    s.applied = desired;
    if (add.length > 0) selection.setAll(add, true);
    if (drop.length > 0) selection.setAll(drop, false);
    navigator.vibrate?.(8);
  }, []);

  const stopLoop = useCallback(() => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
  }, []);

  const loop = useCallback(() => {
    raf.current = null;
    const s = session.current;
    if (!live.current || !s) return;
    // Kartu awal hilang (refetch, daftar berubah): akhiri seret, jangan menggulir terus.
    if (s.startEl && !s.startEl.isConnected) {
      endRef.current();
      return;
    }
    const { y, x } = last.current;
    const scroller = s.scroller;
    const top = scroller ? scroller.getBoundingClientRect().top : 0;
    const bottom = scroller ? scroller.getBoundingClientRect().bottom : window.innerHeight;
    let step = 0;
    if (y < top + EDGE_PX) step = -MAX_STEP_PX * Math.min(1, (top + EDGE_PX - y) / EDGE_PX);
    else if (y > bottom - EDGE_PX)
      step = MAX_STEP_PX * Math.min(1, (y - (bottom - EDGE_PX)) / EDGE_PX);
    if (step !== 0) {
      if (scroller) scroller.scrollTop += step;
      else window.scrollBy(0, step);
      recompute(x, y);
    }
    raf.current = requestAnimationFrame(loop);
  }, [recompute]);

  const end = useCallback(() => {
    live.current = false;
    session.current = null;
    stopLoop();
    window.removeEventListener('pointerup', endRef.current);
    window.removeEventListener('pointercancel', endRef.current);
    window.removeEventListener('lostpointercapture', endRef.current);
    setDragging(false);
  }, [stopLoop]);
  endRef.current = end;

  const begin = useCallback(
    (startId: string, pointer: DragPointer, on: boolean) => {
      const { selection } = argsRef.current;
      if (!selection) return;
      end();
      const snapshot = new Set(selection.selected);
      const startEl = findElement(startId);
      session.current = {
        startId,
        on,
        snapshot,
        applied: snapshot,
        lastTarget: null,
        scroller: scrollParentOf(startEl),
        startEl,
        origin: { x: pointer.x, y: pointer.y },
        moved: false,
      };
      last.current = { x: pointer.x, y: pointer.y };
      live.current = true;
      setDragging(true);
      // Pointer dilepas di mana pun (juga di luar kartu) mengakhiri seret.
      window.addEventListener('pointerup', endRef.current);
      window.addEventListener('pointercancel', endRef.current);
      window.addEventListener('lostpointercapture', endRef.current);
    },
    [end],
  );

  const move = useCallback(
    (x: number, y: number) => {
      if (!live.current) return;
      const s = session.current;
      last.current = { x, y };
      if (s && !s.moved && Math.hypot(x - s.origin.x, y - s.origin.y) > DRAG_TOLERANCE_PX)
        s.moved = true;
      recompute(x, y);
      // Gulir otomatis baru menyala setelah jari benar-benar bergeser (tekan lama di tepi tanpa menarik tidak menggulir).
      if (s?.moved && raf.current === null) raf.current = requestAnimationFrame(loop);
    },
    [recompute, loop],
  );

  const enabled = args.active !== false;
  // Pendengar touchmove tak-pasif permanen selama seret diizinkan: sejak awal tercatat dapat dibatalkan (Chrome Android
  // tak mengirim pointercancel karena gulir). Gulir biasa tak terganggu: preventDefault hanya saat sesi seret hidup.
  useEffect(() => {
    if (!enabled) return;
    const handler = touchBlock.current;
    document.addEventListener('touchmove', handler, { passive: false });
    return () => {
      document.removeEventListener('touchmove', handler);
      end();
    };
  }, [enabled, end]);

  return { begin, move, end, dragging, isActive: () => live.current };
}
