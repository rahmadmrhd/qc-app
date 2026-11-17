import { Camera } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ScanFeedback } from '../lib/scan-feedback';
import type { IsKnown } from '../lib/scan-table';
import { cameraSupported } from '../lib/use-camera-scanner';

// Dialog kamera (dan mesin pembacanya) dimuat malas: tidak membesarkan potongan halaman sebelum dipakai.
const CameraScanDialog = lazy(() =>
  import('./camera-scan-dialog').then((module) => ({ default: module.CameraScanDialog })),
);

export interface CameraScanButtonProps {
  /**
   * Dipanggil saat "Simpan" di dialog, satu kali per serial hasil scan (urutan tabel), lewat jalur yang sama dengan
   * tempel/pindai fisik; mengembalikan hasilnya (diringkas di toast bila ada yang dilewati).
   */
  onScan: (text: string) => ScanFeedback;
  /** Serial yang sudah dimiliki pemakai (mis. sudah di draft): tidak ditambahkan ke tabel hasil scan. */
  isKnown?: IsKnown;
  disabled?: boolean;
  className?: string;
}

/**
 * Tombol ikon "Scan dengan kamera" yang membuka dialog kamera. Tersembunyi bila peramban tak punya
 * `getUserMedia` (bukan HTTPS, atau tak didukung): pindai fisik, ketik, dan tempel tetap jalan.
 */
export function CameraScanButton({
  onScan,
  isKnown,
  disabled = false,
  className,
}: CameraScanButtonProps) {
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
        aria-label="Scan dengan kamera"
        title="Scan dengan kamera"
        onClick={() => setOpen(true)}
      >
        <Camera aria-hidden />
      </Button>
      {open ? (
        <Suspense fallback={null}>
          <CameraScanDialog open={open} onOpenChange={setOpen} onScan={onScan} isKnown={isKnown} />
        </Suspense>
      ) : null}
    </>
  );
}
