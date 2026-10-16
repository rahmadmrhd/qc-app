import { CircleAlert, TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

/** Ringkasan kondisi tata letak label yang perlu diperhatikan pengguna. */
export interface LabelStatus {
  /** Isi tidak muat di kanvas 3 × 3 cm: ekspor diblokir. */
  overflow: boolean;
  /** Modul QR terlalu kecil untuk dicetak/dipindai dengan nyaman: peringatan saja. */
  tooDense: boolean;
  moduleMm: number;
}

/** Banner di atas form: galat (overflow) dan peringatan (QR terlalu padat). Tanpa masalah = tidak merender apa pun. */
export function LabelStatusAlerts({ status }: { status: LabelStatus | null }) {
  if (!status || (!status.overflow && !status.tooDense)) return null;
  return (
    <div className="space-y-2">
      {status.overflow ? (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Isi melebihi kanvas 3 × 3 cm</AlertTitle>
          <AlertDescription>
            Perkecil ukuran bagian atau persingkat teks. Ekspor diblokir sampai isi muat.
          </AlertDescription>
        </Alert>
      ) : null}
      {status.tooDense ? (
        <Alert
          role="status"
          className="border-amber-500/50 text-amber-700 *:data-[slot=alert-description]:text-amber-700/90 dark:text-amber-400 dark:*:data-[slot=alert-description]:text-amber-400/90"
        >
          <TriangleAlert />
          <AlertTitle>QR terlalu padat</AlertTitle>
          <AlertDescription>
            {status.moduleMm.toFixed(2).replace('.', ',')} mm per modul: pendekkan link atau
            perbesar QR agar mudah dipindai. Ekspor tetap diizinkan.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
