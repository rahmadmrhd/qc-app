import { Flashlight, FlashlightOff, Minus, Plus } from 'lucide-react';
import { type MouseEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Select } from '@/components/select';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { BarcodeEngine } from '../lib/barcode-engine';
import { formatZoom } from '../lib/camera-controls';
import { createPayloadGate } from '../lib/camera-payload';
import {
  FEEDBACK_FLASH,
  FEEDBACK_TEXT,
  FEEDBACK_TEXT_COLOR,
  type ScanFeedback,
  useScanFeedback,
} from '../lib/scan-feedback';
import { SCAN_FRAME } from '../lib/scan-region';
import { CAMERA_ERROR_TEXT, useCameraScanner } from '../lib/use-camera-scanner';

export interface CameraScanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Menerima teks hasil bacaan (satu atau banyak serial, satu per baris; sudah disaring dari bacaan ulang) atau yang
   * diketik manual, lewat jalur yang sama dengan tempel/pindai fisik; mengembalikan hasilnya untuk umpan balik.
   */
  onScan: (text: string) => ScanFeedback;
  /** Disuntik tes: pengganti mesin pembaca. */
  createEngine?: () => Promise<BarcodeEngine>;
  /** Disuntik tes: jam untuk jendela bacaan ulang. */
  now?: () => number;
}

/** Lama cincin umpan balik ketuk-untuk-fokus tampil. */
const FOCUS_RING_MS = 900;

/** Langkah minimum tombol zoom "+"/"−" (geser lewat slider tetap halus mengikuti langkah trek). */
const ZOOM_BUTTON_STEP = 0.5;

/**
 * Dialog kamera berkelanjutan: kamera tetap menyala setelah tiap pembacaan, payload baru dikirim ke `onScan`,
 * payload yang sama tidak dikirim ulang dalam `CAMERA_DUPLICATE_WINDOW_MS`. Aliran kamera dimatikan saat ditutup.
 */
export function CameraScanDialog({ open, onOpenChange, ...rest }: CameraScanDialogProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={contentRef}
        className="sm:max-w-md"
        // Fokus awal ke cangkang dialog (bukan elemen tabbable pertama = kolom ketik manual): papan ketik ponsel tidak
        // muncul dan menutupi pratinjau, sementara fokus tetap di dalam dialog (Escape, Tab, dan pembaca layar jalan).
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          contentRef.current?.focus();
        }}
      >
        {/* Isi hanya dipasang selama dialog terbuka: unmount = efek kamera dibersihkan = aliran dimatikan. */}
        <CameraScanBody onClose={() => onOpenChange(false)} {...rest} />
      </DialogContent>
    </Dialog>
  );
}

function CameraScanBody({
  onScan,
  onClose,
  createEngine,
  now,
}: Pick<CameraScanDialogProps, 'onScan' | 'createEngine' | 'now'> & { onClose: () => void }) {
  const gate = useMemo(() => createPayloadGate(undefined, now), [now]);
  const { feedback, announce } = useScanFeedback();
  const [last, setLast] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [typed, setTyped] = useState('');
  const [ring, setRing] = useState<{ x: number; y: number; key: number } | null>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  function deliver(text: string) {
    setLast(text.replace(/\r?\n/g, ', '));
    announce(onScanRef.current(text));
  }

  const camera = useCameraScanner({
    open: true,
    deviceId,
    createEngine,
    now,
    onPayload: (payload) => {
      const text = gate.accept(payload);
      if (text !== null) deliver(text);
    },
  });
  const { state } = camera;

  useEffect(() => {
    if (ring === null) return;
    const timer = setTimeout(() => setRing(null), FOCUS_RING_MS);
    return () => clearTimeout(timer);
  }, [ring]);

  // Ketuk di area video = fokus sekali ke titik itu (hanya bila kamera mendukung; selain itu tidak melakukan apa-apa).
  function onViewportClick(event: MouseEvent<HTMLDivElement>) {
    const video = camera.videoRef.current;
    if (state.status !== 'scanning' || !camera.tapFocusSupported || !video) return;
    if ((event.target as HTMLElement).closest('button')) return;
    const rect = video.getBoundingClientRect();
    const tap = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (camera.focusAt(tap, { width: rect.width, height: rect.height })) {
      setRing({ ...tap, key: Date.now() });
    }
  }

  function submitTyped() {
    if (typed.trim() === '') return;
    const text = typed;
    setTyped('');
    deliver(text);
  }

  const tip = camera.tapFocusSupported
    ? 'Buram? Dekatkan atau jauhkan sedikit, lalu ketuk layar untuk fokus.'
    : camera.zoomRange
      ? 'Buram? Jauhkan sedikit, lalu atur zoom.'
      : '';

  const deviceOptions = camera.devices.map((device) => ({ value: device.id, label: device.label }));

  return (
    <>
      <DialogHeader>
        <DialogTitle>Scan dengan kamera</DialogTitle>
        <DialogDescription>
          Arahkan QR atau barcode ke dalam bingkai. Kamera tetap menyala untuk scan berikutnya.
          {tip ? ` ${tip}` : ''}
        </DialogDescription>
      </DialogHeader>

      {/* Viewport persegi 1:1 (sisi = min(lebar dialog, 55dvh)): sama di ponsel potret/landscape dan desktop. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: ketuk-untuk-fokus hanya pelengkap sentuhan; pemindaian dan semua kontrol lain tetap bisa lewat papan ketik. */}
      <div
        data-testid="camera-viewport"
        onClick={onViewportClick}
        className={cn(
          'relative mx-auto aspect-square w-[min(100%,55dvh)] overflow-hidden rounded-md border-2 border-transparent bg-black',
          feedback !== null && FEEDBACK_FLASH[feedback],
        )}
      >
        <video
          ref={camera.videoRef}
          aria-label="Pratinjau kamera"
          className="absolute inset-0 size-full object-cover"
          playsInline
          muted
        />
        {/* Area scan: hanya kode di dalam bingkai yang dibaca (ukuran bingkai = SCAN_FRAME, sama dengan pemotongan). */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          <div
            data-testid="scan-frame"
            className="rounded-lg border-2 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]"
            style={{
              width: `${SCAN_FRAME.width * 100}%`,
              height: `${SCAN_FRAME.height * 100}%`,
            }}
          />
        </div>
        {ring !== null ? (
          <span
            key={ring.key}
            aria-hidden
            data-testid="focus-ring"
            className="pointer-events-none absolute size-14 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full border-2 border-white motion-reduce:animate-none"
            style={{ left: ring.x, top: ring.y }}
          />
        ) : null}
        <p className="pointer-events-none absolute inset-x-0 bottom-2 px-2 text-center text-xs text-white drop-shadow">
          Arahkan kode ke dalam bingkai
        </p>
        {state.status === 'loading' ? (
          <p
            role="status"
            className="absolute inset-0 flex items-center justify-center bg-black/60 p-4 text-center text-sm text-white"
          >
            Menyiapkan kamera…
          </p>
        ) : null}
        {state.status === 'error' ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 p-4 text-center text-sm text-white">
            <p role="alert">{CAMERA_ERROR_TEXT[state.kind]}</p>
            {state.kind !== 'insecure' && state.kind !== 'unsupported' ? (
              <Button type="button" variant="secondary" size="sm" onClick={camera.retry}>
                Coba lagi
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {deviceOptions.length > 1 ? (
          <Select
            id="camera-device"
            label="Kamera"
            hideLabel
            className="min-w-0 flex-1"
            value={deviceId || camera.activeDeviceId}
            options={deviceOptions}
            onValueChange={setDeviceId}
          />
        ) : null}
        {camera.zoomRange ? (
          <div className="flex min-w-40 flex-1 items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label="Perkecil zoom"
              disabled={camera.zoom <= camera.zoomRange.min}
              onClick={() =>
                void camera.setZoom(
                  camera.zoom - Math.max(camera.zoomRange?.step ?? 0.1, ZOOM_BUTTON_STEP),
                )
              }
            >
              <Minus aria-hidden />
            </Button>
            <input
              type="range"
              aria-label="Zoom"
              className="h-6 min-w-0 flex-1 accent-primary"
              min={camera.zoomRange.min}
              max={camera.zoomRange.max}
              step={camera.zoomRange.step}
              value={camera.zoom}
              onChange={(event) => void camera.setZoom(Number(event.target.value))}
            />
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label="Perbesar zoom"
              disabled={camera.zoom >= camera.zoomRange.max}
              onClick={() =>
                void camera.setZoom(
                  camera.zoom + Math.max(camera.zoomRange?.step ?? 0.1, ZOOM_BUTTON_STEP),
                )
              }
            >
              <Plus aria-hidden />
            </Button>
            <span
              data-testid="zoom-value"
              className="w-10 text-right font-mono text-xs text-muted-foreground"
            >
              {formatZoom(camera.zoom)}
            </span>
          </div>
        ) : null}
        {camera.torchSupported ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-pressed={camera.torchOn}
            onClick={() => void camera.setTorch(!camera.torchOn)}
          >
            {camera.torchOn ? <FlashlightOff aria-hidden /> : <Flashlight aria-hidden />}
            {camera.torchOn ? 'Matikan senter' : 'Nyalakan senter'}
          </Button>
        ) : null}
      </div>

      <p
        aria-live="polite"
        className={cn(
          'min-h-5 truncate text-sm',
          feedback ? FEEDBACK_TEXT_COLOR[feedback] : 'text-muted-foreground',
        )}
      >
        {feedback ? `${FEEDBACK_TEXT[feedback]}: ${last}` : last ? `Terakhir: ${last}` : ''}
      </p>

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          submitTyped();
        }}
      >
        <Input
          aria-label="Ketik serial manual"
          placeholder="Atau ketik serial, lalu Enter"
          className="font-mono"
          value={typed}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          onChange={(event) => setTyped(event.target.value)}
        />
        <Button type="submit" variant="secondary" disabled={typed.trim() === ''}>
          Kirim
        </Button>
      </form>

      <DialogFooter>
        <Button type="button" onClick={onClose}>
          Tutup
        </Button>
      </DialogFooter>
    </>
  );
}
