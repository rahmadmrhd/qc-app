import { type KeyboardEvent, type PointerEvent, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { clampPermil, pointToPermil } from '../lib/sticker-instructions';

/** Langkah geser penanda dengan tombol panah (permil dari lebar/tinggi foto). */
const KEY_STEP = 10;

const ARROWS: Record<string, readonly [number, number]> = {
  ArrowLeft: [-KEY_STEP, 0],
  ArrowRight: [KEY_STEP, 0],
  ArrowUp: [0, -KEY_STEP],
  ArrowDown: [0, KEY_STEP],
};

export interface MarkerCanvasProps {
  src: string;
  /** Dimensi asli gambar (piksel): hanya untuk rasio; tampilan mengikuti lebar wadah. */
  width: number;
  height: number;
  marks: readonly { x: number; y: number }[];
  selected: number | null;
  onSelect: (index: number | null) => void;
  /** Ketuk area kosong: titik baru (permil). */
  onAdd: (point: { x: number; y: number }) => void;
  /** Seret atau geser dengan papan ketik: posisi baru (permil, sudah dijepit 0-1000). */
  onMove: (index: number, point: { x: number; y: number }) => void;
  disabled?: boolean;
}

/**
 * Foto dengan penanda bernomor bergaya tag foto. Ketuk area kosong menambah penanda; penanda dapat diseret
 * (pointer: mouse dan sentuh) dan, saat terfokus, digeser dengan tombol panah (10 permil per tekanan). Daftar baris
 * di bawah foto (`MarkRow`) tetap jalur utama untuk sasaran dan catatan.
 */
export function MarkerCanvas({
  src,
  width,
  height,
  marks,
  selected,
  onSelect,
  onAdd,
  onMove,
  disabled,
}: MarkerCanvasProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);
  // Dimensi tak diketahui (0): rasio diukur dari gambar saat dimuat, agar permil dihitung terhadap area gambar.
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const known = width > 0 && height > 0 ? { width, height } : natural;
  const aspectRatio = known ? `${known.width} / ${known.height}` : '4 / 3';

  function pointOf(event: { clientX: number; clientY: number }) {
    const frame = frameRef.current;
    return frame ? pointToPermil(event, frame.getBoundingClientRect()) : null;
  }

  function addAt(event: { clientX: number; clientY: number; target: EventTarget }) {
    if (disabled) return;
    // Ketukan pada penanda (termasuk akhir seretan) bukan penanda baru.
    if ((event.target as HTMLElement).closest('[data-marker]')) return;
    const point = pointOf(event);
    if (point) onAdd(point);
  }

  function startDrag(event: PointerEvent<HTMLButtonElement>, index: number) {
    if (disabled) return;
    dragging.current = index;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    onSelect(index);
  }

  function drag(event: PointerEvent<HTMLButtonElement>, index: number) {
    if (disabled || dragging.current !== index) return;
    const point = pointOf(event);
    if (point) onMove(index, point);
  }

  function endDrag(event: PointerEvent<HTMLButtonElement>) {
    dragging.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (disabled) return;
    if (event.key === 'Escape') {
      onSelect(null);
      return;
    }
    const step = ARROWS[event.key];
    const mark = marks[index];
    if (!step || !mark) return;
    event.preventDefault();
    onMove(index, { x: clampPermil(mark.x + step[0]), y: clampPermil(mark.y + step[1]) });
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: papan ketik menambah/mengatur penanda lewat daftar baris di bawah foto dan tombol panah pada penanda
    // biome-ignore lint/a11y/useSemanticElements: wadah foto berposisi relatif untuk penanda absolut, bukan kelompok form
    <div
      ref={frameRef}
      role="group"
      aria-label="Foto dengan penanda"
      className={cn(
        'relative w-full select-none rounded-lg bg-muted',
        disabled ? 'cursor-not-allowed' : 'cursor-crosshair',
      )}
      style={{ aspectRatio }}
      onClick={(event) => addAt(event)}
    >
      <img
        src={src}
        alt=""
        draggable={false}
        onLoad={(event) => {
          const { naturalWidth, naturalHeight } = event.currentTarget;
          if (naturalWidth > 0 && naturalHeight > 0) {
            setNatural({ width: naturalWidth, height: naturalHeight });
          }
        }}
        className="pointer-events-none absolute inset-0 size-full rounded-lg object-contain"
      />
      {marks.map((mark, index) => (
        <button
          // biome-ignore lint/suspicious/noArrayIndexKey: penanda tak punya id; nomor = urutan, fokus mengikuti nomor
          key={index}
          type="button"
          data-marker=""
          disabled={disabled}
          aria-label={`Penanda ${index + 1}`}
          aria-pressed={selected === index}
          className={cn(
            'absolute flex size-7 -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center rounded-full border-2 border-background bg-primary text-xs font-semibold text-primary-foreground shadow-md outline-none focus-visible:ring-3 focus-visible:ring-ring disabled:opacity-60',
            disabled ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing',
            selected === index && 'ring-3 ring-ring',
          )}
          style={{ left: `${mark.x / 10}%`, top: `${mark.y / 10}%` }}
          onPointerDown={(event) => startDrag(event, index)}
          onPointerMove={(event) => drag(event, index)}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onClick={() => {
            if (!disabled) onSelect(index);
          }}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          {index + 1}
        </button>
      ))}
    </div>
  );
}
