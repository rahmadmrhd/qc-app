import { Flashlight, FlashlightOff, Minus, Plus, SwitchCamera } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { clampZoom, formatZoom } from '../lib/camera-controls';
import type { UseCameraScanner } from '../lib/use-camera-scanner';
import { zoomStepOf } from '../lib/zoom-math';
import { ZoomSlider } from './zoom-slider';

/** Tombol bulat semi-transparan gelap + ikon putih: terbaca di atas video, target ketuk 44 px. */
export const FLOAT_BUTTON =
  'size-11 rounded-full bg-black/50 text-white hover:bg-black/70 hover:text-white';

/** Panjang trek slider vertikal: menyusut di layar pendek (ponsel landscape) agar tak melebihi area kamera. */
const ZOOM_TRACK_LENGTH = 'clamp(4rem, 24dvh, 11rem)';

/** Tahan tombol + / - : jeda sebelum berulang, lalu selang antar pengulangan. */
const HOLD_DELAY_MS = 400;
const HOLD_INTERVAL_MS = 80;

/**
 * Kontrol kamera yang MENGAMBANG di atas pratinjau: slider zoom vertikal di kanan (label zoom di bawahnya), senter dan
 * ganti kamera di kiri bawah. Kontrol yang tak didukung perangkat tidak dirender. Ketukan pada kontrol tidak
 * diteruskan ke area video (tidak memicu ketuk-untuk-fokus).
 */
export function ScanCameraControls({
  camera,
  onSwitchCamera,
}: {
  camera: UseCameraScanner;
  onSwitchCamera: () => void;
}) {
  const range = camera.zoomRange;
  // Nilai zoom terkini untuk tombol yang berulang (penutup interval tak boleh memakai nilai basi).
  const zoomRef = useRef(camera.zoom);
  zoomRef.current = camera.zoom;
  function stepZoom(direction: 1 | -1) {
    if (!range) return;
    const next = clampZoom(zoomRef.current + direction * zoomStepOf(range), range);
    if (next === zoomRef.current) return;
    // Optimistis: pengulangan berikutnya (sebelum render ulang) melanjutkan dari nilai ini, bukan nilai basi.
    zoomRef.current = next;
    void camera.setZoom(next);
  }
  const canSwitch = camera.devices.length > 1;
  const nextCameraName = nextDevice(camera)?.label;
  return (
    <>
      {camera.torchSupported || canSwitch ? (
        // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: pembungkus hanya menahan ketukan agar tak jatuh ke area video; tombol di dalamnya tetap bisa lewat papan ketik.
        <div
          data-testid="camera-controls-left"
          data-camera-control
          className="absolute bottom-3 left-3 flex items-center gap-2"
          onClick={(event) => event.stopPropagation()}
        >
          {camera.torchSupported ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                FLOAT_BUTTON,
                camera.torchOn && 'bg-amber-400 text-black hover:bg-amber-300 hover:text-black',
              )}
              aria-pressed={camera.torchOn}
              aria-label={camera.torchOn ? 'Matikan senter' : 'Nyalakan senter'}
              title={camera.torchOn ? 'Matikan senter' : 'Nyalakan senter'}
              onClick={() => void camera.setTorch(!camera.torchOn)}
            >
              {camera.torchOn ? <Flashlight aria-hidden /> : <FlashlightOff aria-hidden />}
            </Button>
          ) : null}
          {canSwitch ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={FLOAT_BUTTON}
              aria-label="Ganti kamera"
              title={nextCameraName ? `Ganti ke ${nextCameraName}` : 'Ganti kamera'}
              onClick={onSwitchCamera}
            >
              <SwitchCamera aria-hidden />
            </Button>
          ) : null}
        </div>
      ) : null}
      {range ? (
        // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: lihat di atas.
        <div
          data-testid="camera-controls-zoom"
          data-camera-control
          className="absolute right-3 bottom-3 flex flex-col items-center gap-1"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex flex-col items-center rounded-full bg-black/50 py-1 text-white">
            <ZoomStepButton
              label="Perbesar"
              icon={<Plus aria-hidden />}
              disabled={camera.zoom >= range.max}
              onStep={() => stepZoom(1)}
            />
            <ZoomSlider
              value={camera.zoom}
              range={range}
              length={ZOOM_TRACK_LENGTH}
              onChange={(value) => void camera.setZoom(value)}
            />
            <ZoomStepButton
              label="Perkecil"
              icon={<Minus aria-hidden />}
              disabled={camera.zoom <= range.min}
              onStep={() => stepZoom(-1)}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            data-testid="zoom-value"
            className={cn(FLOAT_BUTTON, 'w-11 min-w-11 px-0 font-mono text-xs tabular-nums')}
            aria-label={`Zoom ${formatZoom(camera.zoom)}, ketuk untuk kembali ke 1x`}
            title="Kembali ke 1x"
            onClick={() => void camera.setZoom(1)}
          >
            {formatZoom(camera.zoom)}
          </Button>
        </div>
      ) : null}
    </>
  );
}

/** Kamera berikutnya (melingkar) untuk tombol ganti kamera; id aktif tak dikenal = kamera pertama. */
export function nextDevice(
  camera: Pick<UseCameraScanner, 'devices' | 'activeDeviceId'>,
  currentId: string = camera.activeDeviceId,
) {
  const { devices } = camera;
  if (devices.length < 2) return undefined;
  const index = devices.findIndex((device) => device.id === currentId);
  return devices[(index + 1) % devices.length];
}

/**
 * Tombol + / - zoom (44 px): satu tekan = satu langkah, tahan = berulang. Klik dari papan ketik (`detail` 0) juga
 * menggeser satu langkah; klik sentuh/mouse sudah ditangani `pointerdown` (tidak dihitung dua kali).
 */
export function ZoomStepButton({
  label,
  icon,
  disabled,
  onStep,
}: {
  label: string;
  icon: ReactNode;
  disabled: boolean;
  onStep: () => void;
}) {
  const delay = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeat = useRef<ReturnType<typeof setInterval> | null>(null);
  const stepRef = useRef(onStep);
  stepRef.current = onStep;

  // Stabil (hanya menyentuh ref) agar aman dipakai di dependensi efek.
  const stop = useCallback(() => {
    if (delay.current !== null) clearTimeout(delay.current);
    if (repeat.current !== null) clearInterval(repeat.current);
    delay.current = null;
    repeat.current = null;
  }, []);
  // Tombol berhenti saat melewati batas (disabled) atau dilepas dari pohon.
  useEffect(() => {
    if (disabled) stop();
  }, [disabled, stop]);
  useEffect(() => stop, [stop]);

  return (
    <Button
      type="button"
      variant="ghost"
      className="size-11 touch-none rounded-full text-white hover:bg-white/10 hover:text-white"
      aria-label={label}
      title={label}
      disabled={disabled}
      onPointerDown={(event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        stop();
        stepRef.current();
        delay.current = setTimeout(() => {
          repeat.current = setInterval(() => stepRef.current(), HOLD_INTERVAL_MS);
        }, HOLD_DELAY_MS);
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onClick={(event) => {
        if (event.detail === 0) onStep();
      }}
    >
      {icon}
    </Button>
  );
}
