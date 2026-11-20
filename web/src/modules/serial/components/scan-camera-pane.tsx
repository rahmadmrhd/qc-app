import { type MouseEvent, useEffect, useState } from 'react';
import { nextDevice, ScanCameraControls } from '@/components/camera/camera-controls';
import { usePinchZoom } from '@/components/camera/use-pinch-zoom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { FEEDBACK_FLASH, FEEDBACK_TEXT, type ScanFeedback } from '../lib/scan-feedback';
import { SCAN_FRAME } from '../lib/scan-region';
import { CAMERA_ERROR_TEXT, type UseCameraScanner } from '../lib/use-camera-scanner';

/** Lama cincin umpan balik ketuk-untuk-fokus tampil. */
const FOCUS_RING_MS = 900;

/** Lama nama kamera aktif tampil setelah berganti kamera. */
const CAMERA_NAME_MS = 2500;

/** Warna teks hasil di atas latar gelap pratinjau (selalu hitam, jadi tak mengikuti tema). */
const FEEDBACK_TEXT_ON_DARK: Record<ScanFeedback, string> = {
  added: 'text-emerald-300',
  duplicate: 'text-amber-300',
  rejected: 'text-red-300',
};

export interface ScanCameraPaneProps {
  camera: UseCameraScanner;
  /** Id kamera pilihan (milik pemanggil, diteruskan ke hook kamera); kosong = bawaan. */
  deviceId: string;
  onDeviceChange: (id: string) => void;
  /** Hasil bacaan terakhir untuk kilat bingkai dan teks hasil; `null` = tak ada. */
  feedback: ScanFeedback | null;
  /** Teks hasil di bawah petunjuk (mis. serial yang terbaca atau alasan penolakan). */
  resultText: string;
  /** Mengisi seluruh tinggi pembungkus (mode satu serial/langkah scan); selain itu tinggi dibatasi di layar sempit. */
  fill?: boolean;
}

/**
 * Pandangan kamera dialog scan: video, bingkai area scan, petunjuk dan hasil terakhir, keadaan memuat/galat dengan
 * "Coba lagi", cincin ketuk-untuk-fokus, cubit-untuk-zoom, nama kamera, dan kontrol mengambang. Dipakai dialog scan
 * batch dan dialog scan item wajib foto (langkah 1) dengan perilaku yang sama.
 */
export function ScanCameraPane({
  camera,
  deviceId,
  onDeviceChange,
  feedback,
  resultText,
  fill = false,
}: ScanCameraPaneProps) {
  const { state } = camera;
  const [ring, setRing] = useState<{ x: number; y: number; key: number } | null>(null);
  const [cameraName, setCameraName] = useState<string | null>(null);

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

  // Ketuk di area video = fokus sekali ke titik itu (hanya bila kamera mendukung; selain itu tidak melakukan apa-apa).
  // Kontrol mengambang menahan ketukannya sendiri (tidak sampai ke sini).
  // Cubit dua jari = zoom (hanya bila kamera mendukung zoom); gestur itu bukan ketukan.
  const pinch = usePinchZoom({
    zoom: camera.zoom,
    range: state.status === 'scanning' ? camera.zoomRange : null,
    setZoom: (value) => void camera.setZoom(value),
  });

  function onViewportClick(event: MouseEvent<HTMLDivElement>) {
    // Klik susulan setelah cubitan (jari diangkat) tidak boleh memicu fokus.
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
      onDeviceChange(next.id);
      setCameraName(next.label);
    }
  }

  const tip = camera.tapFocusSupported
    ? 'Arahkan kode ke dalam bingkai, ketuk layar untuk fokus.'
    : camera.zoomRange
      ? 'Arahkan kode ke dalam bingkai, lalu atur zoom kalau buram.'
      : 'Arahkan kode ke dalam bingkai.';

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: ketuk-untuk-fokus hanya pelengkap sentuhan; pemindaian dan semua kontrol lain tetap bisa lewat papan ketik.
    <div
      data-testid="camera-viewport"
      onClick={onViewportClick}
      onPointerDown={pinch.onPointerDown}
      onPointerMove={pinch.onPointerMove}
      onPointerUp={pinch.onPointerUp}
      onPointerCancel={pinch.onPointerCancel}
      className={cn(
        // `touch-none`: gestur dua jari di area kamera dipakai untuk zoom, bukan menggulir/mencubit halaman.
        'relative w-full touch-none overflow-hidden border-2 border-transparent bg-black',
        fill ? 'h-auto' : 'h-[clamp(11rem,55dvh,40rem)] md:h-auto landscape:h-auto',
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
      {/* Petunjuk dan hasil terakhir di bagian atas, di luar bingkai (tidak menutupinya). */}
      {state.status !== 'error' ? (
        <div className="pointer-events-none absolute inset-x-3 top-2 flex flex-col items-center gap-1">
          <p className="rounded-md bg-black/50 px-2 py-1 text-center text-xs text-white [@media(max-height:30rem)]:hidden">
            {tip}
          </p>
          <p
            aria-live="polite"
            // Tetap dirender (kosong tanpa latar) agar pembaca layar mengumumkan perubahannya.
            className={cn(
              'max-w-full truncate rounded-md px-2 py-1 text-sm font-medium',
              feedback ? `bg-black/70 ${FEEDBACK_TEXT_ON_DARK[feedback]}` : 'p-0',
            )}
          >
            {feedback ? `${FEEDBACK_TEXT[feedback]}: ${resultText}` : ''}
          </p>
        </div>
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
          className="pointer-events-none absolute bottom-[4.5rem] left-3 max-w-[60%] truncate rounded-md bg-black/60 px-2 py-1 text-xs text-white"
        >
          {cameraName}
        </p>
      ) : null}
      {state.status !== 'error' ? (
        <ScanCameraControls camera={camera} onSwitchCamera={switchCamera} />
      ) : null}
    </div>
  );
}
