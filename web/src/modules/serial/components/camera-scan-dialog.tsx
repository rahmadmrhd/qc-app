import { Flashlight, FlashlightOff } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
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
import { createPayloadGate } from '../lib/camera-payload';
import {
  FEEDBACK_FLASH,
  FEEDBACK_TEXT,
  FEEDBACK_TEXT_COLOR,
  type ScanFeedback,
  useScanFeedback,
} from '../lib/scan-feedback';
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
    onPayload: (payload) => {
      const text = gate.accept(payload);
      if (text !== null) deliver(text);
    },
  });
  const { state } = camera;

  function submitTyped() {
    if (typed.trim() === '') return;
    const text = typed;
    setTyped('');
    deliver(text);
  }

  const deviceOptions = camera.devices.map((device) => ({ value: device.id, label: device.label }));

  return (
    <>
      <DialogHeader>
        <DialogTitle>Scan dengan kamera</DialogTitle>
        <DialogDescription>
          Arahkan kamera ke QR atau barcode. Kamera tetap menyala untuk scan berikutnya.
        </DialogDescription>
      </DialogHeader>

      <div
        className={cn(
          'relative overflow-hidden rounded-md border-2 border-transparent bg-black',
          feedback !== null && FEEDBACK_FLASH[feedback],
        )}
      >
        <video
          ref={camera.videoRef}
          aria-label="Pratinjau kamera"
          className="aspect-[4/3] w-full object-cover"
          playsInline
          muted
        />
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
