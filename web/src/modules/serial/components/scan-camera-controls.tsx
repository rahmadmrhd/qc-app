import { Flashlight, FlashlightOff, SwitchCamera } from 'lucide-react';
import type { CSSProperties } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatZoom } from '../lib/camera-controls';
import type { UseCameraScanner } from '../lib/use-camera-scanner';

/** Tombol bulat semi-transparan gelap + ikon putih: terbaca di atas video, target ketuk 44 px. */
const FLOAT_BUTTON =
  'size-11 rounded-full bg-black/50 text-white hover:bg-black/70 hover:text-white';

/** Panjang trek slider vertikal: menyusut di layar pendek (ponsel landscape) agar tak melebihi area kamera. */
const ZOOM_TRACK_LENGTH = 'clamp(6rem, 28dvh, 11rem)';

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
  const canSwitch = camera.devices.length > 1;
  const nextCameraName = nextDevice(camera)?.label;
  return (
    <>
      {camera.torchSupported || canSwitch ? (
        // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: pembungkus hanya menahan ketukan agar tak jatuh ke area video; tombol di dalamnya tetap bisa lewat papan ketik.
        <div
          data-testid="camera-controls-left"
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
          className="absolute right-3 bottom-3 flex flex-col items-center gap-1"
          style={{ '--zoom-length': ZOOM_TRACK_LENGTH } as CSSProperties}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex flex-col items-center rounded-full bg-black/50 py-2 text-white">
            <span aria-hidden className="text-base leading-none font-semibold">
              +
            </span>
            {/* Trek vertikal = input range horizontal yang diputar -90 derajat (paling andal lintas peramban); */}
            {/* ujung kecil di bawah, ujung besar di atas; sentuh dan papan ketik (panah) tetap bekerja. */}
            <div className="relative h-(--zoom-length) w-11">
              <input
                type="range"
                aria-label="Zoom"
                aria-orientation="vertical"
                aria-valuetext={formatZoom(camera.zoom)}
                className="absolute top-1/2 left-1/2 h-11 w-(--zoom-length) -translate-x-1/2 -translate-y-1/2 -rotate-90 cursor-pointer accent-white"
                min={range.min}
                max={range.max}
                step={range.step}
                value={camera.zoom}
                onChange={(event) => void camera.setZoom(Number(event.target.value))}
              />
            </div>
            <span aria-hidden className="text-base leading-none font-semibold">
              −
            </span>
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
