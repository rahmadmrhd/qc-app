import { Camera } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ScanFeedback } from '../lib/scan-feedback';
import { cameraSupported } from '../lib/use-camera-scanner';

// Dialog kamera (dan mesin pembacanya) dimuat malas: tidak membesarkan potongan halaman sebelum dipakai.
const CameraScanDialog = lazy(() =>
  import('./camera-scan-dialog').then((module) => ({ default: module.CameraScanDialog })),
);

export interface CameraScanButtonProps {
  /** Jalur yang sama dengan tempel/pindai fisik; mengembalikan hasil untuk umpan balik di dialog. */
  onScan: (text: string) => ScanFeedback;
  disabled?: boolean;
  className?: string;
}

/**
 * Tombol ikon "Pindai dengan kamera" yang membuka dialog kamera. Tersembunyi bila peramban tak punya
 * `getUserMedia` (bukan HTTPS, atau tak didukung): pindai fisik, ketik, dan tempel tetap jalan.
 */
export function CameraScanButton({ onScan, disabled = false, className }: CameraScanButtonProps) {
  const [open, setOpen] = useState(false);
  if (!cameraSupported()) return null;
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        className={className}
        disabled={disabled}
        aria-label="Pindai dengan kamera"
        title="Pindai dengan kamera"
        onClick={() => setOpen(true)}
      >
        <Camera aria-hidden />
      </Button>
      {open ? (
        <Suspense fallback={null}>
          <CameraScanDialog open={open} onOpenChange={setOpen} onScan={onScan} />
        </Suspense>
      ) : null}
    </>
  );
}
