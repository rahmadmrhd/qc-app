import type { PendingEntry } from '@countrylock/pending';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const BRAND_LABELS: Record<PendingEntry['brand'], string> = {
  mikrotik: 'Mikrotik',
  ubiquiti: 'Ubiquiti',
  none: '-',
};

function reinjectedLabel(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? 'Diinject ulang'
    : `Diinject ulang ${date.toLocaleString('id-ID')}`;
}

/**
 * Antrean perangkat yang sudah di-inject dan belum diunggah. Pengunggahan butuh modul Daftar Serial
 * Number di server (proyek 2), sehingga tombolnya sengaja nonaktif dengan penjelasan terlihat.
 */
export function PendingList({ entries }: { entries: readonly PendingEntry[] }) {
  return (
    <section className="space-y-3" aria-labelledby="country-lock-pending-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="country-lock-pending-title" className="font-medium">
          Perangkat tercatat ({entries.length})
        </h2>
        <Button
          type="button"
          variant="outline"
          disabled
          aria-describedby="country-lock-upload-note"
        >
          Unggah ke server
        </Button>
      </div>
      <p id="country-lock-upload-note" className="text-xs text-muted-foreground">
        Unggah ke server tersedia setelah modul Daftar Serial Number dirilis. Sementara itu, hasil
        inject disimpan di komputer ini.
      </p>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Belum ada perangkat yang tercatat.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Serial</TableHead>
              <TableHead>Merk</TableHead>
              <TableHead>Tipe</TableHead>
              <TableHead>BU</TableHead>
              <TableHead>Lokasi</TableHead>
              <TableHead>Tanggal</TableHead>
              <TableHead>Keterangan</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.serial}>
                <TableCell className="font-mono">{entry.serial}</TableCell>
                <TableCell>{BRAND_LABELS[entry.brand]}</TableCell>
                <TableCell>{entry.tipe || '-'}</TableCell>
                <TableCell>{entry.buLabel || '-'}</TableCell>
                <TableCell>{entry.locationLabel || '-'}</TableCell>
                <TableCell>{entry.date}</TableCell>
                <TableCell>{reinjectedLabel(entry.reinjectedAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
