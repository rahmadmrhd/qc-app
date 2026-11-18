import { type MouseEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { captureFrame } from '../lib/photo-capture';
import type { ProofPhotoRef } from '../lib/proof-source';
import type { StampPreviewInput } from '../lib/stamp-preview';
import { CAMERA_ERROR_TEXT, type CameraErrorKind, useCameraStream } from '../lib/use-camera-stream';
import { usePinchZoom } from '../lib/use-pinch-zoom';
import { ProofPhotoGrid } from './proof-photo-grid';
import { nextDevice, ScanCameraControls } from './scan-camera-controls';
import { StampPreview } from './stamp-preview';

export interface ProofCameraDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Sisa foto yang masih boleh ditambah; 0 = rana nonaktif. */
  remaining: number;
  /** Tanpa ini pratinjau cap tidak ditampilkan. */
  stamp?: StampPreviewInput | undefined;
  /**
   * Dipanggil dengan berkas JPEG tiap jepretan. Menolak (Error berpesan) bila foto tak dapat ditambahkan; pesannya
   * tampil di dialog. Tidak ditunggu oleh rana: jepretan berikutnya boleh jalan selagi yang sebelumnya diunggah.
   */
  onShot(file: File): Promise<void>;
  /** Foto yang sudah dibidik pada pembukaan dialog foto ini (kisi). */
  shots: ProofPhotoRef[];
  /** Kamera dilaporkan tak dapat dipakai (izin ditolak dsb.): pemanggil boleh menyembunyikan tombol Kamera. */
  onUnavailable?(kind: CameraErrorKind): void;
  /** Kamera menyala (termasuk sesudah "Coba lagi" yang berhasil): pemanggil boleh menampilkan tombol Kamera lagi. */
  onAvailable?(): void;
}

/** Lama kilat putih tiap jepretan. */
const FLASH_MS = 140;
/** Lama cincin ketuk-untuk-fokus tampil. */
const FOCUS_RING_MS = 900;
/** Lama nama kamera aktif tampil setelah berganti kamera. */
const CAMERA_NAME_MS = 2500;

const UNAVAILABLE_KINDS: readonly CameraErrorKind[] = [
  'denied',
  'notfound',
  'insecure',
  'unsupported',
];

function messageOf(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message !== '' ? reason.message : fallback;
}

/**
 * Kamera foto bukti layar penuh (AlertDialog `size="full"`): pandangan kamera dengan kontrol mengambang (zoom, senter,
 * ganti kamera), pratinjau cap, rana, dan kisi foto yang sudah dibidik. Isi hanya dipasang selama dialog terbuka:
 * unmount = aliran kamera dilepas. Foto hanya dibidik di sini; unggah dan penyimpanan oleh pemanggil (`onShot`).
 */
export function ProofCameraDialog({ open, onOpenChange, ...rest }: ProofCameraDialogProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        ref={contentRef}
        size="full"
        // Fokus awal ke cangkang dialog (bukan tombol): papan ketik tidak muncul dan fokus tetap di dalam dialog.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          contentRef.current?.focus();
        }}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          onOpenChange(false);
        }}
      >
        <ProofCameraBody onClose={() => onOpenChange(false)} {...rest} />
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ProofCameraBody({
  onClose,
  remaining,
  stamp,
  onShot,
  shots,
  onUnavailable,
  onAvailable,
}: Omit<ProofCameraDialogProps, 'open' | 'onOpenChange'> & { onClose: () => void }) {
  const [deviceId, setDeviceId] = useState('');
  const camera = useCameraStream({ open: true, deviceId });
  const { state } = camera;
  const [flash, setFlash] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ring, setRing] = useState<{ x: number; y: number; key: number } | null>(null);
  const [cameraName, setCameraName] = useState<string | null>(null);
  const aliveRef = useRef(true);
  const capturingRef = useRef(false);
  const onShotRef = useRef(onShot);
  onShotRef.current = onShot;
  const onUnavailableRef = useRef(onUnavailable);
  onUnavailableRef.current = onUnavailable;
  const onAvailableRef = useRef(onAvailable);
  onAvailableRef.current = onAvailable;

  // Efek (bukan nilai awal): StrictMode memasang ulang efek, jadi penanda harus dinyalakan lagi di sini.
  useLayoutEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const errorKind = state.status === 'error' ? state.kind : null;
  useEffect(() => {
    if (errorKind !== null && UNAVAILABLE_KINDS.includes(errorKind)) {
      onUnavailableRef.current?.(errorKind);
    }
  }, [errorKind]);

  const scanning = state.status === 'scanning';
  useEffect(() => {
    if (scanning) onAvailableRef.current?.();
  }, [scanning]);

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(false), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flash]);
  useEffect(() => {
    if (ring === null) return;
    const timer = setTimeout(() => setRing(null), FOCUS_RING_MS);
    return () => clearTimeout(timer);
  }, [ring]);
  useEffect(() => {
    if (cameraName === null) return;
    const timer = setTimeout(() => setCameraName(null), CAMERA_NAME_MS);
    return () => clearTimeout(timer);
  }, [cameraName]);

  const pinch = usePinchZoom({
    zoom: camera.zoom,
    range: state.status === 'scanning' ? camera.zoomRange : null,
    setZoom: (value) => void camera.setZoom(value),
  });

  function onViewportClick(event: MouseEvent<HTMLDivElement>) {
    if (pinch.wasPinching()) return;
    const video = camera.videoRef.current;
    if (state.status !== 'scanning' || !camera.tapFocusSupported || !video) return;
    if ((event.target as HTMLElement).closest('button')) return;
    const rect = video.getBoundingClientRect();
    const tap = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (camera.focusAt(tap, { width: rect.width, height: rect.height })) {
      setRing({ ...tap, key: Date.now() });
    }
  }

  function switchCamera() {
    const next = nextDevice(camera, deviceId || camera.activeDeviceId);
    if (next) {
      setDeviceId(next.id);
      setCameraName(next.label);
    }
  }

  async function shoot() {
    const video = camera.videoRef.current;
    if (!video || capturingRef.current || remaining <= 0 || state.status !== 'scanning') return;
    capturingRef.current = true;
    setCapturing(true);
    setError(null);
    try {
      const file = await captureFrame(video, `foto-${Date.now()}.jpg`);
      if (!aliveRef.current) return;
      // Umpan balik jepretan: kilat singkat dan getar ringan (tanpa nada).
      setFlash(true);
      try {
        navigator.vibrate?.(25);
      } catch {
        // Getar tidak didukung.
      }
      // Tidak ditunggu: jepretan berikutnya boleh jalan selagi ini diunggah. Pesan penolakan tampil di dialog.
      onShotRef.current(file).catch((reason: unknown) => {
        if (aliveRef.current) setError(messageOf(reason, 'Foto gagal ditambahkan'));
      });
    } catch (reason) {
      if (aliveRef.current) setError(messageOf(reason, 'Gagal mengambil foto'));
    } finally {
      capturingRef.current = false;
      if (aliveRef.current) setCapturing(false);
    }
  }

  const full = remaining <= 0;
  const ready = state.status === 'scanning';

  return (
    <>
      <AlertDialogTitle className="sr-only">Kamera foto bukti</AlertDialogTitle>
      <AlertDialogDescription className="sr-only">
        Arahkan kamera ke unit lalu tekan tombol bulat untuk memotret. Tekan Selesai bila sudah
        cukup.
      </AlertDialogDescription>

      {/* Ponsel portrait = 1 kolom (kamera atas, kisi bawah); lebar >= md ATAU landscape = 2 kolom. */}
      <div
        data-testid="proof-camera-layout"
        className="flex min-h-0 flex-1 flex-col md:flex-row landscape:flex-row"
      >
        <div className="flex shrink-0 flex-col bg-black md:w-1/2 md:shrink landscape:w-1/2 landscape:shrink">
          {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: ketuk-untuk-fokus hanya pelengkap sentuhan; rana dan semua kontrol lain tetap bisa lewat papan ketik. */}
          <div
            data-testid="camera-viewport"
            onClick={onViewportClick}
            onPointerDown={pinch.onPointerDown}
            onPointerMove={pinch.onPointerMove}
            onPointerUp={pinch.onPointerUp}
            onPointerCancel={pinch.onPointerCancel}
            className="relative h-[clamp(11rem,50dvh,40rem)] w-full touch-none overflow-hidden bg-black md:h-auto md:min-h-0 md:flex-1 landscape:h-auto landscape:min-h-0 landscape:flex-1"
          >
            <video
              ref={camera.videoRef}
              aria-label="Pratinjau kamera"
              className="absolute inset-0 size-full object-cover"
              playsInline
              muted
            />
            {flash ? (
              <span
                aria-hidden
                data-testid="shutter-flash"
                className="pointer-events-none absolute inset-0 bg-white/70"
              />
            ) : null}
            {ring !== null ? (
              <span
                key={ring.key}
                aria-hidden
                data-testid="focus-ring"
                className="pointer-events-none absolute size-14 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full border-2 border-white motion-reduce:animate-none"
                style={{ left: ring.x, top: ring.y }}
              />
            ) : null}
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
            {cameraName !== null && state.status !== 'error' ? (
              <p
                data-testid="camera-name"
                aria-live="polite"
                className="pointer-events-none absolute top-2 left-3 max-w-[60%] truncate rounded-md bg-black/60 px-2 py-1 text-xs text-white"
              >
                {cameraName}
              </p>
            ) : null}
            {state.status !== 'error' && stamp ? <StampPreview input={stamp} /> : null}
            {state.status !== 'error' ? (
              <ScanCameraControls camera={camera} onSwitchCamera={switchCamera} />
            ) : null}
          </div>
          <div className="flex shrink-0 items-center justify-center py-3">
            <button
              type="button"
              aria-label="Ambil foto"
              title={full ? 'Batas foto tercapai' : 'Ambil foto'}
              disabled={!ready || capturing || full}
              onClick={() => void shoot()}
              className={cn(
                'flex size-16 items-center justify-center rounded-full border-4 border-white outline-none focus-visible:ring-4 focus-visible:ring-ring/60',
                'disabled:opacity-40',
              )}
            >
              <span className="size-12 rounded-full bg-white" />
            </button>
          </div>
        </div>

        <div className="flex min-h-0 w-full flex-1 flex-col gap-3 overflow-y-auto p-4 md:w-1/2 landscape:w-1/2">
          <p aria-live="polite" className="text-sm">
            {full
              ? 'Batas foto tercapai.'
              : `${shots.length} foto dibidik. Sisa ${remaining} foto lagi.`}
          </p>
          {error !== null ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <ProofPhotoGrid photos={shots} label="hasil kamera" />
        </div>
      </div>

      <AlertDialogFooter className="bottom-0 mx-0 mb-0 shrink-0 flex-row rounded-none p-0">
        <div className="grid w-full grid-cols-1 p-4">
          <Button type="button" size="lg" className="h-11" onClick={onClose}>
            Selesai
          </Button>
        </div>
      </AlertDialogFooter>
    </>
  );
}
