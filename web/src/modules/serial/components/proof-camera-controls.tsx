import { Flashlight, FlashlightOff, Minus, Plus, SwitchCamera } from 'lucide-react';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { clampZoom, formatZoom } from '../lib/camera-controls';
import type { UseCameraScanner } from '../lib/use-camera-scanner';
import { zoomStepOf } from '../lib/zoom-math';
import { FLOAT_BUTTON, nextDevice, ZoomStepButton } from './scan-camera-controls';
import { ZoomSlider } from './zoom-slider';

/**
 * Panjang trek slider zoom kamera foto: menyusut di layar pendek (ponsel landscape ~360 px) agar kolom zoom tidak
 * bertabrakan dengan baris rana di bawahnya.
 */
const ZOOM_TRACK_LENGTH = 'clamp(3.5rem, 24dvh, 11rem)';

/** Layar pendek (ponsel landscape): tombol + / - disembunyikan, slider dan cubit zoom tetap ada. */
const SHORT_SCREEN = '[@media(max-height:30rem)]:hidden';

/**
 * Tombol senter dan ganti kamera untuk kamera foto layar penuh. Dirender sebagai fragmen: pemanggil menaruhnya di
 * gugus tombol kanan atas bersama tombol lain. Tombol yang tak didukung perangkat tidak dirender.
 */
export function CameraTopButtons({
  camera,
  onSwitchCamera,
}: {
  camera: UseCameraScanner;
  onSwitchCamera: () => void;
}) {
  const canSwitch = camera.devices.length > 1;
  const nextCameraName = nextDevice(camera)?.label;
  return (
    <>
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
    </>
  );
}

/**
 * Kolom zoom di kanan-tengah pandangan kamera: tombol +, slider vertikal, tombol -, dan label zoom (ketuk = 1x).
 * Tidak dirender bila kamera tak mendukung zoom. Ketukan di sini tidak diteruskan ke area video (tanpa ketuk-fokus).
 */
export function CameraZoomRail({ camera }: { camera: UseCameraScanner }) {
  const range = camera.zoomRange;
  // Nilai zoom terkini untuk tombol yang berulang (penutup interval tak boleh memakai nilai basi).
  const zoomRef = useRef(camera.zoom);
  zoomRef.current = camera.zoom;
  if (!range) return null;
  function stepZoom(direction: 1 | -1) {
    if (!range) return;
    const next = clampZoom(zoomRef.current + direction * zoomStepOf(range), range);
    if (next === zoomRef.current) return;
    zoomRef.current = next;
    void camera.setZoom(next);
  }
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: pembungkus hanya menahan ketukan agar tak jatuh ke area video; tombol di dalamnya tetap bisa lewat papan ketik.
    <div
      data-testid="camera-controls-zoom"
      data-camera-control
      className="absolute top-1/2 right-[max(0.75rem,env(safe-area-inset-right))] flex -translate-y-1/2 flex-col items-center gap-1"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex flex-col items-center rounded-full bg-black/50 py-1 text-white">
        <div className={SHORT_SCREEN}>
          <ZoomStepButton
            label="Perbesar"
            icon={<Plus aria-hidden />}
            disabled={camera.zoom >= range.max}
            onStep={() => stepZoom(1)}
          />
        </div>
        <ZoomSlider
          value={camera.zoom}
          range={range}
          length={ZOOM_TRACK_LENGTH}
          onChange={(value) => void camera.setZoom(value)}
        />
        <div className={SHORT_SCREEN}>
          <ZoomStepButton
            label="Perkecil"
            icon={<Minus aria-hidden />}
            disabled={camera.zoom <= range.min}
            onStep={() => stepZoom(-1)}
          />
        </div>
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
  );
}
