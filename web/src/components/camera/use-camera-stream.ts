import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { ScannerLoadError } from '@/modules/serial/lib/barcode-engine';
import {
  applyContinuousFocus,
  applyTapFocus,
  applyZoom,
  type CameraCaps,
  clampZoom,
  describeCameras,
  initialZoom,
  readCameraCaps,
  restoreContinuousFocus,
  type ZoomRange,
} from '@/modules/serial/lib/camera-controls';
import { type Point, type Size, tapToVideoPoint } from '@/modules/serial/lib/scan-region';

/** Setelah ketuk-untuk-fokus (sekali), fokus kembali ke mode kontinu sesudah jeda ini (cukup lama agar single-shot lambat tak terpotong). */
export const TAP_FOCUS_RESTORE_MS = 2500;

/** Resolusi yang diminta (ideal, bukan exact: kamera yang tak bisa tetap terbuka). Label kecil butuh piksel lebih banyak. */
const IDEAL_WIDTH = 1920;
const IDEAL_HEIGHT = 1080;

const NO_CAPS: CameraCaps = {
  torch: false,
  zoom: null,
  focusModes: [],
  continuousFocus: false,
  tapFocus: false,
};

export type CameraErrorKind =
  | 'insecure'
  | 'unsupported'
  | 'denied'
  | 'notfound'
  | 'busy'
  | 'loader'
  | 'unknown';

export const CAMERA_ERROR_TEXT: Record<CameraErrorKind, string> = {
  insecure:
    'Kamera hanya bisa dipakai lewat koneksi aman (HTTPS). Buka aplikasi lewat alamat https:// atau ketik serial manual.',
  unsupported: 'Browser ini tidak mendukung akses kamera. Ketik serial manual.',
  denied:
    'Izin kamera ditolak. Izinkan kamera untuk situs ini di pengaturan browser, lalu coba lagi.',
  notfound: 'Kamera tidak ditemukan di perangkat ini. Ketik serial manual.',
  busy: 'Kamera sedang dipakai aplikasi lain atau tidak bisa dibuka. Tutup aplikasi itu, lalu coba lagi.',
  loader: 'Fitur scan gagal dimuat. Cek koneksi lalu coba lagi, atau ketik serial manual.',
  unknown: 'Kamera tidak bisa dibuka. Coba lagi atau ketik serial manual.',
};

export interface CameraDevice {
  id: string;
  label: string;
}

export type CameraState =
  | { status: 'loading' }
  | { status: 'scanning' }
  | { status: 'error'; kind: CameraErrorKind };

/** Kamera dapat dicoba: konteks aman dan `getUserMedia` tersedia. Dipakai tombol untuk tersembunyi bila tidak. */
export function cameraSupported(): boolean {
  return (
    typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function'
  );
}

function unavailableKind(): CameraErrorKind | null {
  if (cameraSupported()) return null;
  return typeof window !== 'undefined' && window.isSecureContext === false
    ? 'insecure'
    : 'unsupported';
}

export function classifyCameraError(error: unknown): CameraErrorKind {
  if (error instanceof ScannerLoadError) return 'loader';
  const name = (error as { name?: string } | null)?.name;
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
    case 'PermissionDeniedError':
      return 'denied';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'notfound';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'busy';
    default:
      return 'unknown';
  }
}

export interface UseCameraStreamOptions {
  /** Kamera hanya menyala selama `true`; `false`/unmount mematikan aliran. */
  open: boolean;
  /** Id perangkat pilihan; kosong = kamera belakang bila ada. */
  deviceId: string;
}

export interface CameraStream {
  videoRef: RefObject<HTMLVideoElement | null>;
  state: CameraState;
  devices: CameraDevice[];
  /** Id perangkat yang sedang dipakai (dari trek), '' bila belum diketahui. */
  activeDeviceId: string;
  torchSupported: boolean;
  torchOn: boolean;
  setTorch: (on: boolean) => Promise<void>;
  /** Zoom saat ini (1 = tanpa zoom) dan rentangnya; `null` bila kamera tak mendukung zoom. */
  zoom: number;
  zoomRange: ZoomRange | null;
  setZoom: (value: number) => Promise<void>;
  /** Ketuk-untuk-fokus tersedia (trek mendukung fokus `single-shot`). */
  tapFocusSupported: boolean;
  /**
   * Fokus sekali ke titik ketukan: `tap` = posisi di kotak tampilan video (piksel, relatif sudut kiri-atas kotak),
   * `box` = ukuran kotak itu. `true` bila perintah dikirim (untuk umpan balik visual); `false` = tidak ada efek.
   */
  focusAt: (tap: Point, box: Size) => boolean;
  /** Coba lagi setelah galat. */
  retry: () => void;
  /**
   * Pemakai (mis. pemindai yang pemuat mesinnya gagal) menjadikan keadaan kamera galat: aliran dimatikan dan
   * `state` menjadi galat jenis itu sampai `retry`.
   */
  reportError: (kind: CameraErrorKind) => void;
}

/**
 * Aliran kamera bersama (izin, `getUserMedia`, visibilitas tab, senter, zoom, ketuk-fokus, daftar kamera, coba lagi).
 * Dipakai pemindai barcode (`useCameraScanner`, menambah mesin + loop baca) dan kamera foto bukti.
 */
export function useCameraStream({ open, deviceId }: UseCameraStreamOptions): CameraStream {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const capsRef = useRef<CameraCaps>(NO_CAPS);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoomRef = useRef(1);

  const [streamState, setStreamState] = useState<CameraState>({ status: 'loading' });
  const [forcedError, setForcedError] = useState<CameraErrorKind | null>(null);
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState('');
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [zoomRange, setZoomRange] = useState<ZoomRange | null>(null);
  const [zoom, setZoomValue] = useState(1);
  const [tapFocusSupported, setTapFocusSupported] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const state: CameraState =
    forcedError !== null ? { status: 'error', kind: forcedError } : streamState;
  // Tab tersembunyi: kamera dilepas sepenuhnya (trek dihentikan) dan dinyalakan lagi saat terlihat. HANYA
  // bila kamera sedang jalan (memuat atau memindai): dalam keadaan galat tab tak menyentuh apa pun, pesan galat tetap
  // dan pengguna yang menekan "Coba lagi" (tidak ada percobaan otomatis yang memunculkan ulang izin/galat).
  const [paused, setPaused] = useState(() => document.hidden);
  const statusRef = useRef<CameraState['status']>('loading');
  statusRef.current = state.status;
  useEffect(() => {
    if (!open) return;
    const onChange = () => {
      if (document.hidden) {
        if (statusRef.current !== 'error') setPaused(true);
      } else {
        setPaused(false);
      }
    };
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, [open]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `open` hanya pemicu: galat paksa dibersihkan tiap dialog dibuka/ditutup.
  useEffect(() => {
    setForcedError(null);
  }, [open]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` hanya pemicu jalan ulang ("Coba lagi").
  useEffect(() => {
    if (!open || paused || forcedError !== null) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    // Trek milik run ini: `stop()` hanya membersihkan keadaan bersama (trackRef, srcObject) bila masih miliknya.
    let ownTrack: MediaStreamTrack | null = null;

    // Tiap (re)start: "Menyiapkan kamera…" dan senter/zoom kembali ke awal (trek baru selalu mulai tanpa senter, 1x).
    setStreamState({ status: 'loading' });
    setTorchSupported(false);
    setTorchOn(false);
    setZoomRange(null);
    zoomRef.current = 1;
    setZoomValue(1);
    setTapFocusSupported(false);

    const stop = () => {
      const own = stream;
      for (const track of own?.getTracks() ?? []) track.stop();
      stream = null;
      if (ownTrack !== null && trackRef.current === ownTrack) {
        trackRef.current = null;
        capsRef.current = NO_CAPS;
        // Timer kembali-ke-kontinu milik trek yang berlaku: run lama yang selesai terlambat tak boleh membatalkannya.
        if (tapTimerRef.current !== null) clearTimeout(tapTimerRef.current);
        tapTimerRef.current = null;
      }
      ownTrack = null;
      const video = videoRef.current;
      if (video && own !== null && video.srcObject === own) video.srcObject = null;
    };

    const fail = (kind: CameraErrorKind) => {
      stop();
      if (!cancelled) setStreamState({ status: 'error', kind });
    };

    async function run() {
      const unavailable = unavailableKind();
      if (unavailable) return fail(unavailable);

      try {
        const size = { width: { ideal: IDEAL_WIDTH }, height: { ideal: IDEAL_HEIGHT } };
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: deviceId
            ? { deviceId: { exact: deviceId }, ...size }
            : { facingMode: { ideal: 'environment' }, ...size },
        });
      } catch (error) {
        return fail(classifyCameraError(error));
      }
      if (cancelled) return stop();

      const track = stream.getVideoTracks()[0];
      trackRef.current = track ?? null;
      ownTrack = track ?? null;
      const caps = track ? readCameraCaps(track) : NO_CAPS;
      capsRef.current = caps;
      setTorchSupported(caps.torch);
      setZoomRange(caps.zoom);
      zoomRef.current = caps.zoom
        ? initialZoom(caps.zoom, (track?.getSettings?.() as { zoom?: number } | undefined)?.zoom)
        : 1;
      setZoomValue(zoomRef.current);
      setTapFocusSupported(caps.tapFocus);
      setActiveDeviceId(track?.getSettings?.().deviceId ?? '');
      // Fokus kontinu (bila didukung): tanpa ini banyak ponsel mengunci fokus di jarak awal dan label dekat buram.
      if (track && caps.continuousFocus) void applyContinuousFocus(track);

      const video = videoRef.current;
      if (!video) return fail('unknown');
      video.srcObject = stream;
      try {
        await video.play();
      } catch (error) {
        if ((error as { name?: string } | null)?.name !== 'AbortError') return fail('busy');
      }
      if (cancelled) return stop();

      try {
        const all = (await navigator.mediaDevices.enumerateDevices?.()) ?? [];
        if (!cancelled) {
          setDevices(
            describeCameras(
              all
                .filter((device) => device.kind === 'videoinput')
                .map((device, index) => ({
                  id: device.deviceId,
                  label: device.label || `Kamera ${index + 1}`,
                })),
            ),
          );
        }
      } catch {
        // Tanpa daftar perangkat pemilih kamera tidak tampil; aliran tetap jalan.
      }
      if (cancelled) return stop();
      setStreamState({ status: 'scanning' });
    }

    void run();
    return () => {
      cancelled = true;
      stop();
    };
  }, [open, paused, deviceId, attempt, forcedError]);

  const setTorch = useCallback(async (on: boolean) => {
    const track = trackRef.current;
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
      // Kamera sempat dimulai ulang selagi menunggu: trek ini sudah tidak berlaku, jangan ubah tampilan senter.
      if (trackRef.current === track) setTorchOn(on);
    } catch {
      if (trackRef.current === track) setTorchOn(false);
    }
  }, []);

  const setZoom = useCallback(async (value: number) => {
    const track = trackRef.current;
    const range = capsRef.current.zoom;
    if (!track || !range) return;
    const next = clampZoom(value, range);
    const previous = zoomRef.current;
    zoomRef.current = next;
    setZoomValue(next);
    const applied = await applyZoom(track, next);
    // Gagal: kembalikan hanya bila trek ini masih yang berlaku (kamera mungkin sempat dimulai ulang).
    if (!applied && trackRef.current === track && zoomRef.current === next) {
      zoomRef.current = previous;
      setZoomValue(previous);
    }
  }, []);

  const focusAt = useCallback((tap: Point, box: Size) => {
    const track = trackRef.current;
    const video = videoRef.current;
    const caps = capsRef.current;
    if (!track || !video || !caps.tapFocus) return false;
    const point = tapToVideoPoint(tap, { width: video.videoWidth, height: video.videoHeight }, box);
    if (!point) return false;
    void applyTapFocus(track, point);
    if (tapTimerRef.current !== null) clearTimeout(tapTimerRef.current);
    // Setelah fokus sekali, kembali ke kontinu agar fokus tetap mengikuti label yang bergerak.
    tapTimerRef.current = setTimeout(() => {
      tapTimerRef.current = null;
      if (trackRef.current === track && caps.continuousFocus) void restoreContinuousFocus(track);
    }, TAP_FOCUS_RESTORE_MS);
    return true;
  }, []);

  const retry = useCallback(() => {
    setForcedError(null);
    setAttempt((n) => n + 1);
  }, []);

  const reportError = useCallback((kind: CameraErrorKind) => {
    // Status aliran ikut ditandai belum siap: aliran dimatikan oleh efek, jangan sisakan 'scanning' yang basi.
    setStreamState({ status: 'loading' });
    setForcedError(kind);
  }, []);

  return {
    videoRef,
    state,
    devices,
    activeDeviceId,
    torchSupported,
    torchOn,
    setTorch,
    zoom,
    zoomRange,
    setZoom,
    tapFocusSupported,
    focusAt,
    retry,
    reportError,
  };
}
