import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { type BarcodeEngine, createBarcodeEngine, ScannerLoadError } from './barcode-engine';
import { createScanCapturer } from './scan-capture';
import { pickNearestCenter } from './scan-region';

/** Jeda antar pembacaan bingkai (~8 fps); cukup untuk label dan hemat baterai. */
export const SCAN_INTERVAL_MS = 120;

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

interface TorchCapabilities {
  torch?: boolean;
}

export interface UseCameraScannerOptions {
  /** Kamera hanya menyala selama `true`; `false`/unmount mematikan aliran. */
  open: boolean;
  /** Id perangkat pilihan; kosong = kamera belakang bila ada. */
  deviceId: string;
  onPayload: (payload: string) => void;
  /** Disuntik tes. */
  createEngine?: () => Promise<BarcodeEngine>;
}

export interface UseCameraScanner {
  videoRef: RefObject<HTMLVideoElement | null>;
  state: CameraState;
  devices: CameraDevice[];
  /** Id perangkat yang sedang dipakai (dari trek), '' bila belum diketahui. */
  activeDeviceId: string;
  torchSupported: boolean;
  torchOn: boolean;
  setTorch: (on: boolean) => Promise<void>;
  /** Coba lagi setelah galat. */
  retry: () => void;
}

export function useCameraScanner({
  open,
  deviceId,
  onPayload,
  createEngine = createBarcodeEngine,
}: UseCameraScannerOptions): UseCameraScanner {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const onPayloadRef = useRef(onPayload);
  onPayloadRef.current = onPayload;
  const createEngineRef = useRef(createEngine);
  createEngineRef.current = createEngine;

  const [state, setState] = useState<CameraState>({ status: 'loading' });
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState('');
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Tab tersembunyi: kamera dilepas sepenuhnya (trek dihentikan, loop berhenti) dan dinyalakan lagi saat terlihat. HANYA
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` hanya pemicu jalan ulang ("Coba lagi").
  useEffect(() => {
    if (!open || paused) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let engine: BarcodeEngine | null = null;
    // Trek milik run ini: `stop()` hanya membersihkan keadaan bersama (trackRef, srcObject) bila masih miliknya.
    let ownTrack: MediaStreamTrack | null = null;

    // Tiap (re)start: "Menyiapkan kamera…" dan senter kembali MATI (trek baru selalu mulai tanpa senter).
    setState({ status: 'loading' });
    setTorchSupported(false);
    setTorchOn(false);

    const stop = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      const own = stream;
      for (const track of own?.getTracks() ?? []) track.stop();
      stream = null;
      if (ownTrack !== null && trackRef.current === ownTrack) trackRef.current = null;
      ownTrack = null;
      const video = videoRef.current;
      if (video && own !== null && video.srcObject === own) video.srcObject = null;
    };

    const fail = (kind: CameraErrorKind) => {
      stop();
      if (!cancelled) setState({ status: 'error', kind });
    };

    async function run() {
      const unavailable = unavailableKind();
      if (unavailable) return fail(unavailable);

      // Mesin (dan WASM-nya) dimuat sambil menunggu izin kamera; galatnya ditangani setelah izin selesai.
      const enginePromise = createEngineRef.current();
      enginePromise.catch(() => undefined);

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: deviceId
            ? { deviceId: { exact: deviceId } }
            : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
        });
      } catch (error) {
        return fail(classifyCameraError(error));
      }
      if (cancelled) return stop();

      try {
        engine = await enginePromise;
      } catch (error) {
        return fail(classifyCameraError(error));
      }
      if (cancelled) return stop();

      const track = stream.getVideoTracks()[0];
      trackRef.current = track ?? null;
      ownTrack = track ?? null;
      const capabilities = (track?.getCapabilities?.() ?? {}) as TorchCapabilities;
      setTorchSupported(capabilities.torch === true);
      setActiveDeviceId(track?.getSettings?.().deviceId ?? '');

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
            all
              .filter((device) => device.kind === 'videoinput')
              .map((device, index) => ({
                id: device.deviceId,
                label: device.label || `Kamera ${index + 1}`,
              })),
          );
        }
      } catch {
        // Tanpa daftar perangkat pemilih kamera tidak tampil; pemindaian tetap jalan.
      }
      if (cancelled) return stop();
      setState({ status: 'scanning' });

      const capture = createScanCapturer();
      const tick = async () => {
        timer = null;
        if (cancelled || !engine) return;
        // Tab tersembunyi tak sampai sini: kamera dilepas (efek dibersihkan) dan dimulai ulang saat terlihat.
        if (video.readyState >= 2) {
          try {
            // Hanya piksel di dalam bingkai yang dibaca, dan dari beberapa kode di bingkai hanya yang paling
            // dekat tengah yang diteruskan (label nyata sering memuat kode lain yang tak diperlukan).
            const { source, center } = capture(video);
            const payload = pickNearestCenter(await engine.detectCodes(source), center);
            if (cancelled) return;
            if (payload !== null) onPayloadRef.current(payload);
          } catch {
            // Bingkai gagal dibaca: coba bingkai berikutnya.
          }
        }
        if (!cancelled) timer = setTimeout(tick, SCAN_INTERVAL_MS);
      };
      timer = setTimeout(tick, SCAN_INTERVAL_MS);
    }

    void run();
    return () => {
      cancelled = true;
      stop();
    };
  }, [open, paused, deviceId, attempt]);

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

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { videoRef, state, devices, activeDeviceId, torchSupported, torchOn, setTorch, retry };
}
