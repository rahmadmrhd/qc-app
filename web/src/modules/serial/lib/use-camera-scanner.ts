import { useCallback, useEffect, useRef, useState } from 'react';
import { type BarcodeEngine, createBarcodeEngine } from './barcode-engine';
import { createScanCapturer } from './scan-capture';
import { createScanConfirmer } from './scan-confirm';
import { pickNearestCenterCode } from './scan-region';
import {
  type CameraErrorKind,
  type CameraState,
  type CameraStream,
  cameraSupported,
  classifyCameraError,
  useCameraStream,
} from './use-camera-stream';

// Aliran kamera (izin, senter, zoom, fokus, daftar kamera) tinggal di `use-camera-stream.ts`; berkas ini hanya
// menambahkan mesin pembaca dan loop baca. Ekspor lama tetap tersedia dari sini.
export {
  CAMERA_ERROR_TEXT,
  type CameraDevice,
  type CameraErrorKind,
  type CameraState,
  cameraSupported,
  classifyCameraError,
  TAP_FOCUS_RESTORE_MS,
} from './use-camera-stream';

/** Jeda antar pembacaan bingkai (~8 fps); cukup untuk label dan hemat baterai. */
export const SCAN_INTERVAL_MS = 120;

export interface UseCameraScannerOptions {
  /** Kamera hanya menyala selama `true`; `false`/unmount mematikan aliran. */
  open: boolean;
  /** Id perangkat pilihan; kosong = kamera belakang bila ada. */
  deviceId: string;
  /** Dipanggil hanya untuk bacaan yang sudah terkonfirmasi pada beberapa bingkai berturut-turut. */
  onPayload: (payload: string) => void;
  /** Disuntik tes. */
  createEngine?: () => Promise<BarcodeEngine>;
  /** Disuntik tes: jam untuk jendela konfirmasi bingkai. */
  now?: () => number;
}

export type UseCameraScanner = CameraStream;

export function useCameraScanner({
  open,
  deviceId,
  onPayload,
  createEngine = createBarcodeEngine,
  now,
}: UseCameraScannerOptions): UseCameraScanner {
  const stream = useCameraStream({ open, deviceId });
  const { videoRef, reportError, retry: retryStream } = stream;
  const streamStatus = stream.state.status;
  const onPayloadRef = useRef(onPayload);
  onPayloadRef.current = onPayload;
  const createEngineRef = useRef(createEngine);
  createEngineRef.current = createEngine;
  const nowRef = useRef(now);
  nowRef.current = now;

  const [engine, setEngine] = useState<BarcodeEngine | null>(null);
  const [engineError, setEngineError] = useState<CameraErrorKind | null>(null);
  const [engineAttempt, setEngineAttempt] = useState(0);

  // Mesin (dan WASM-nya) dimuat sambil menunggu izin kamera; galatnya dilaporkan setelah aliran siap.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `engineAttempt` hanya pemicu muat ulang ("Coba lagi").
  useEffect(() => {
    if (!open || !cameraSupported()) return;
    let cancelled = false;
    setEngine(null);
    setEngineError(null);
    createEngineRef.current().then(
      (loaded) => {
        if (!cancelled) setEngine(loaded);
      },
      (error) => {
        if (!cancelled) setEngineError(classifyCameraError(error));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open, engineAttempt]);

  // Mesin gagal dimuat tetapi kamera sudah jalan: jadikan galat (aliran dimatikan). Galat izin/kamera lebih dulu menang.
  useEffect(() => {
    if (engineError !== null && streamStatus === 'scanning') reportError(engineError);
  }, [engineError, streamStatus, reportError]);

  const ready = open && engine !== null && streamStatus === 'scanning';
  useEffect(() => {
    if (!ready || engine === null) return;
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const capture = createScanCapturer();
    // Satu bacaan tak cukup: teks yang sama harus terbaca pada beberapa bingkai berturut-turut (bacaan parsial
    // dari bingkai buram berganti-ganti dan tak pernah lolos).
    const confirmer = createScanConfirmer({ now: nowRef.current });
    const tick = async () => {
      timer = null;
      // Tab tersembunyi: kamera dilepas oleh aliran, jadi loop berhenti (tidak menjadwalkan lagi). Saat tab terlihat
      // aliran dimulai ulang (loading lalu scanning) dan efek ini dijalankan baru dengan penguji bacaan yang baru.
      if (cancelled || document.hidden) return;
      if (video.readyState >= 2) {
        try {
          // Hanya piksel di dalam bingkai yang dibaca, dan dari beberapa kode di bingkai hanya yang paling
          // dekat tengah yang diteruskan (label nyata sering memuat kode lain yang tak diperlukan).
          const { source, center } = capture(video);
          const code = pickNearestCenterCode(await engine.detectCodes(source), center);
          if (cancelled) return;
          const payload = confirmer.observe(
            code ? { text: code.text, ...(code.format ? { format: code.format } : {}) } : null,
          );
          if (payload !== null) onPayloadRef.current(payload);
        } catch {
          // Bingkai gagal dibaca: seri konfirmasi putus, coba bingkai berikutnya.
          confirmer.observe(null);
        }
      }
      if (!cancelled) timer = setTimeout(tick, SCAN_INTERVAL_MS);
    };
    timer = setTimeout(tick, SCAN_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [ready, engine, videoRef]);

  const retry = useCallback(() => {
    // Mesin dimuat ulang hanya bila pemuatnya yang gagal; galat izin/kamera cukup memulai ulang aliran.
    setEngineError(null);
    setEngineAttempt((n) => n + 1);
    retryStream();
  }, [retryStream]);

  // "Menyiapkan kamera…" bertahan sampai mesin juga siap (pemindai belum bisa dipakai sebelumnya).
  const state: CameraState =
    streamStatus === 'scanning' && engine === null ? { status: 'loading' } : stream.state;

  return { ...stream, state, retry };
}
