import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useRef,
} from 'react';
import { cn } from '@/lib/utils';
import { formatZoom, type ZoomRange } from './camera-caps';
import { fractionOfZoom, keyboardZoom, zoomFromTrackY } from './zoom-math';

/** Jari-jari thumb (px): pusat thumb bergerak di antara bantalan ini dari tiap ujung area tekan. */
const THUMB_RADIUS = 16;

export interface ZoomSliderProps {
  value: number;
  range: ZoomRange;
  /** Dipanggil dengan zoom baru (sudah dijepit/dibulatkan); geser dibatasi satu panggilan per bingkai layar. */
  onChange: (value: number) => void;
  /** Panjang area tekan (nilai CSS, mis. `clamp(...)`). */
  length: string;
  className?: string;
}

/**
 * Slider zoom VERTIKAL buatan sendiri (atas = zoom besar). Area tekan selebar 44 px di seluruh panjangnya, sedangkan
 * trek yang terlihat tipis; thumb besar. Pointer events + `setPointerCapture`: menekan di mana pun pada trek melompat
 * ke posisi itu, menggeser mengikuti jari dengan proporsional (`touch-action: none` agar gestur tak menggulir halaman).
 * Aksesibel: `role="slider"`, nilai/teks nilai, orientasi vertikal, papan ketik (panah, PageUp/PageDown, Home/End).
 */
export function ZoomSlider({ value, range, onChange, length, className }: ZoomSliderProps) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const frame = useRef<number | null>(null);
  const pendingY = useRef(0);
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const rangeRef = useRef(range);
  rangeRef.current = range;

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  function apply(y: number) {
    const element = ref.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const next = zoomFromTrackY(
      y,
      { top: rect.top, height: rect.height, pad: THUMB_RADIUS },
      rangeRef.current,
    );
    if (next !== null && next !== valueRef.current) {
      valueRef.current = next;
      onChangeRef.current(next);
    }
  }

  function cancelFrame() {
    if (frame.current === null) return;
    cancelAnimationFrame(frame.current);
    frame.current = null;
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    dragging.current = true;
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Pointer sudah tak aktif: geser tetap bekerja lewat peristiwa elemen ini.
    }
    // Klik trek melompat langsung (tanpa menunggu bingkai).
    apply(event.clientY);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    pendingY.current = event.clientY;
    // Satu pembaruan per bingkai layar: tidak membanjiri `applyConstraints` kamera.
    if (frame.current === null) {
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        apply(pendingY.current);
      });
    }
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    dragging.current = false;
    cancelFrame();
    if (event.type === 'pointerup') apply(event.clientY);
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // Sudah dilepas.
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const next = keyboardZoom(event.key, valueRef.current, rangeRef.current);
    if (next === null) return;
    event.preventDefault();
    if (next !== valueRef.current) {
      valueRef.current = next;
      onChangeRef.current(next);
    }
  }

  const fraction = fractionOfZoom(value, range);
  const thumbStyle: CSSProperties = {
    bottom: `calc(${THUMB_RADIUS}px + (100% - ${2 * THUMB_RADIUS}px) * ${fraction})`,
  };

  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label="Zoom"
      aria-orientation="vertical"
      aria-valuemin={range.min}
      aria-valuemax={range.max}
      aria-valuenow={value}
      aria-valuetext={formatZoom(value)}
      data-testid="zoom-slider"
      className={cn(
        'relative w-11 cursor-pointer touch-none select-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-white/80',
        className,
      )}
      style={{ height: length }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
    >
      {/* Trek yang terlihat tipis (area tekan tetap selebar komponen). */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-1/2 w-1 -translate-x-1/2 rounded-full bg-white/40"
        style={{ top: THUMB_RADIUS, bottom: THUMB_RADIUS }}
      />
      <span
        aria-hidden
        data-testid="zoom-thumb"
        className="pointer-events-none absolute left-1/2 size-8 -translate-x-1/2 translate-y-1/2 rounded-full bg-white shadow-md ring-1 ring-black/20"
        style={thumbStyle}
      />
    </div>
  );
}
