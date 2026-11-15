import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import {
  type CameraErrorKind,
  type CameraState,
  cameraSupported,
  classifyCameraError,
} from './use-camera-scanner';

export interface UsePhotoCameraOptions {
  /** Kamera hanya menyala selama `true`; `false`/unmount mematikan aliran. */
  enabled: boolean;
}

export interface UsePhotoCamera {
  videoRef: RefObject<HTMLVideoElement | null>;
  /** `scanning` = pratinjau langsung sudah tampil dan siap mengambil foto (nama keadaan dipakai bersama pemindai). */
  state: CameraState;
  /** Mengambil bingkai terkini sebagai berkas JPEG; `null` bila kamera belum siap atau bingkai gagal dibaca. */
  capture(): Promise<File | null>;
  /** Coba lagi setelah galat. */
  retry(): void;
}

/** Sisi terpanjang bingkai yang diambil; browser tetap mengecilkannya lagi (`prepareImage`) sebelum diunggah. */
const CAPTURE_MAX_SIDE = 2560;
const CAPTURE_QUALITY = 0.92;

function unavailableKind(): CameraErrorKind | null {
  if (cameraSupported()) return null;
  return typeof window !== 'undefined' && window.isSecureContext === false
    ? 'insecure'
    : 'unsupported';
}

let captureCounter = 0;

/**
 * Kamera untuk mengambil foto (bukan memindai kode): pratinjau langsung di `videoRef`, `capture()` menghasilkan berkas.
 * Aliran dilepas saat `enabled` false, saat unmount, dan saat tab browser tersembunyi (dinyalakan lagi saat terlihat,
 * kecuali sedang galat: pesan galat tetap dan pengguna yang menekan "Coba lagi").
 */
export function usePhotoCamera({ enabled }: UsePhotoCameraOptions): UsePhotoCamera {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [state, setState] = useState<CameraState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [paused, setPaused] = useState(() => typeof document !== 'undefined' && document.hidden);
  const statusRef = useRef<CameraState['status']>('loading');
  statusRef.current = state.status;

  useEffect(() => {
    if (!enabled) return;
    const onChange = () => {
      if (document.hidden) {
        if (statusRef.current !== 'error') setPaused(true);
      } else {
        setPaused(false);
      }
    };
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, [enabled]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` hanya pemicu jalan ulang ("Coba lagi").
  useEffect(() => {
    if (!enabled || paused) return;
    let cancelled = false;
    let stream: MediaStream | null = null;

    setState({ status: 'loading' });

    const stop = () => {
      const own = stream;
      for (const track of own?.getTracks() ?? []) track.stop();
      stream = null;
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
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } },
        });
      } catch (error) {
        return fail(classifyCameraError(error));
      }
      if (cancelled) return stop();
      const video = videoRef.current;
      if (!video) return fail('unknown');
      video.srcObject = stream;
      try {
        await video.play();
      } catch (error) {
        if ((error as { name?: string } | null)?.name !== 'AbortError') return fail('busy');
      }
      if (cancelled) return stop();
      setState({ status: 'scanning' });
    }

    void run();
    return () => {
      cancelled = true;
      stop();
    };
  }, [enabled, paused, attempt]);

  const capture = useCallback(async (): Promise<File | null> => {
    const video = videoRef.current;
    if (!video || statusRef.current !== 'scanning') return null;
    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    if (!sourceWidth || !sourceHeight) return null;
    const scale = Math.min(1, CAPTURE_MAX_SIDE / Math.max(sourceWidth, sourceHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', CAPTURE_QUALITY),
    );
    if (!blob) return null;
    captureCounter += 1;
    return new File([blob], `foto-${Date.now()}-${captureCounter}.jpg`, { type: 'image/jpeg' });
  }, []);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { videoRef, state, capture, retry };
}
