import { cn } from 'cn';
import { type RefObject, useRef } from 'react';

/** Seretan dihitung sebagai gestur bila melewati jarak ini (px), atau cukup cepat (px/ms) dan melewati jarak minimum. */
const DRAG_DISTANCE = 48;
const DRAG_MIN_FOR_VELOCITY = 16;
const DRAG_VELOCITY = 0.5;
/** Di bawah jarak ini pelepasan dianggap ketukan (membalik collapsed/expanded). */
const TAP_DISTANCE = 6;

/**
 * Pegangan lembar bawah (B2d), SATU-SATUNYA implementasi gestur untuk semua lembar bawah (`ui/sheet.tsx` dan mode
 * `sheet` combobox): seret ke atas = layar penuh (expanded), seret ke bawah dari layar penuh = tinggi awal (collapsed),
 * seret ke bawah dari tinggi awal = `onClose`; ketukan, Enter, atau Spasi membalik collapsed/expanded, panah atas atau
 * bawah mengatur keadaannya. Ditangani dengan pointer events; selama menyeret lembar (`targetRef`) mengikuti jari lewat
 * `transform` (tanpa render ulang). `keepFocus` = jangan memindah fokus dari elemen lain saat disentuh (mis. kolom
 * input combobox yang akan menutup daftarnya bila kehilangan fokus) dan tak dapat difokus lewat Tab.
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
  const start = useRef<{ y: number; at: number; id: number } | null>(null);
  // Seretan baru saja selesai: `click` yang menyusul pelepasan jari tidak boleh dihitung sebagai ketukan.
  const dragged = useRef(false);

  const setOffset = (value: number | null) => {
    const node = targetRef.current;
    if (!node) return;
    node.style.transition = value === null ? '' : 'none';
    node.style.transform = value === null ? '' : `translateY(${value}px)`;
  };

  const finish = (clientY: number, cancelled: boolean) => {
    const origin = start.current;
    start.current = null;
    setOffset(null);
    if (!origin || cancelled) return;
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
    if (!passed) return;
    if (dy < 0) {
      if (!expanded) onExpandedChange(true);
    } else if (expanded) {
      onExpandedChange(false);
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
        start.current = { y: event.clientY, at: performance.now(), id: event.pointerId };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        const origin = start.current;
        if (!origin || origin.id !== event.pointerId) return;
        const dy = event.clientY - origin.y;
        // Ke atas hanya diikuti saat belum expanded (lembar tak melewati batas atas layar).
        setOffset(expanded ? Math.max(dy, 0) : Math.max(dy, -DRAG_DISTANCE * 2));
      }}
      onPointerUp={(event) => finish(event.clientY, false)}
      onPointerCancel={(event) => finish(event.clientY, true)}
      onClick={() => {
        if (dragged.current) {
          dragged.current = false;
          return;
        }
        // Enter dan Spasi pada <button> menghasilkan `click`, jadi keyboard setara dengan ketukan.
        onExpandedChange(!expanded);
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowUp' && !expanded) {
          event.preventDefault();
          onExpandedChange(true);
        } else if (event.key === 'ArrowDown' && expanded) {
          event.preventDefault();
          onExpandedChange(false);
        }
      }}
    >
      <span aria-hidden className="h-1.5 w-10 rounded-full bg-muted-foreground/30" />
    </button>
  );
}
