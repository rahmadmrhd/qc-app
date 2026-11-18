import { Camera } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { Button } from '@/components/ui/button';
import { type ScanFeedback, unlockScanAudio } from '../lib/scan-feedback';
import type { IsKnown } from '../lib/scan-table';
import { cameraSupported } from '../lib/use-camera-scanner';
import type { CameraScanDialogProps } from './camera-scan-dialog';
import type { StrictInfo, StrictScanDialogProps } from './strict-scan-dialog';

// Dialog kamera (dan mesin pembacanya) dimuat malas: tidak membesarkan potongan halaman sebelum dipakai.
const CameraScanDialog = lazy(() =>
  import('./camera-scan-dialog').then((module) => ({ default: module.CameraScanDialog })),
);

const StrictScanDialog = lazy(() =>
  import('./strict-scan-dialog').then((module) => ({ default: module.StrictScanDialog })),
);

/** Konteks item wajib foto: tombol membuka dialog dua langkah (scan satu serial lalu konfirmasi + foto). */
export interface StrictScan {
  info: StrictInfo;
  isKnown: IsKnown;
  onConfirm: StrictScanDialogProps['onConfirm'];
  /** Sisa kapasitas draft; habis = dialog hanya memberi tahu batas (lihat `StrictScanDialogProps.capacity`). */
  capacity?: () => number;
}

export interface CameraScanButtonProps {
  /**
   * Dipanggil saat "Simpan" di dialog, satu kali per serial hasil scan (urutan tabel), lewat jalur yang sama dengan
   * tempel/pindai fisik; mengembalikan hasilnya (diringkas di toast bila ada yang dilewati).
   */
  onScan: (text: string) => ScanFeedback;
  /** Serial yang sudah dimiliki pemakai (mis. sudah di draft): tidak ditambahkan ke tabel hasil scan. */
  isKnown?: IsKnown;
  /** Pemakai satu-serial (Lapor Rusak): kamera layar penuh tanpa tabel; serial sah pertama langsung dipakai. */
  single?: boolean;
  /** Hasil semua baris sesudah Simpan (bila diisi, menggantikan toast ringkasan dialog). */
  onSaved?: CameraScanDialogProps['onSaved'];
  /** Sisa kapasitas draft pemakai (jumlah baris yang masih boleh ditambah). */
  draftCapacity?: CameraScanDialogProps['draftCapacity'];
  /** Item wajib foto: dialog dua langkah menggantikan dialog scan batch (`onScan`/`onSaved` tak dipakai). */
  strict?: StrictScan | undefined;
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
  single,
  onSaved,
  draftCapacity,
  strict,
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
        onClick={() => {
          // Gerak pengguna yang membuka dialog: saatnya menyiapkan Web Audio (iOS menolaknya dari pembacaan kamera).
          unlockScanAudio();
          setOpen(true);
        }}
      >
        <Camera aria-hidden />
      </Button>
      {open && strict ? (
        <Suspense fallback={null}>
          <StrictScanDialog
            open={open}
            onOpenChange={setOpen}
            info={strict.info}
            isKnown={strict.isKnown}
            onConfirm={strict.onConfirm}
            capacity={strict.capacity}
          />
        </Suspense>
      ) : null}
      {open && !strict ? (
        <Suspense fallback={null}>
          <CameraScanDialog
            open={open}
            onOpenChange={setOpen}
            onScan={onScan}
            isKnown={isKnown}
            single={single}
            onSaved={onSaved}
            draftCapacity={draftCapacity}
          />
        </Suspense>
      ) : null}
    </>
  );
}
