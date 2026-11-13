import { isIsoDate, normalizeSerial, SERIAL_LIMITS, serialProblem } from '@shared/serials';
import { memo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { StagingRow } from '../lib/draft';

export interface StagingTableProps {
  rows: readonly StagingRow[];
  onSelect: (clientId: string, selected: boolean) => void;
  onSelectAll: (selected: boolean) => void;
  /** Mengubah kolom baris (mengosongkan hasil/pesan penyimpanan sebelumnya). */
  onEdit: (clientId: string, patch: Partial<StagingRow>) => void;
  /** Serial baru (bentuk ternormalisasi); mengembalikan pesan galat bila ditolak (mis. ganda di tabel). */
  onCommitSerial: (clientId: string, serial: string) => string | null;
  onOpenDetail: (clientId: string) => void;
  onRemove: (clientId: string) => void;
  /** Penyimpanan berjalan: seluruh sel dikunci agar suntingan tidak hilang saat baris dihapus oleh hasil `created`. */
  disabled?: boolean;
}

/** Penanda sebuah baris: hasil dari server, rujukan yang harus dipilih ulang, atau kolom wajib yang kosong. */
export function rowStatus(row: StagingRow): { tone: 'error' | 'warn' | 'ok'; text: string } {
  if (row.unresolved && row.unresolved.length > 0) {
    const names = row.unresolved.map((key) =>
      key === 'item' ? 'item' : key === 'location' ? 'lokasi' : 'stiker',
    );
    return { tone: 'error', text: `Pilih ulang ${names.join(', ')} (tidak ditemukan)` };
  }
  if (row.result === 'duplicate') {
    return { tone: 'warn', text: row.message || 'Serial sudah terdaftar' };
  }
  if (row.result === 'invalid' || row.result === 'error') {
    return { tone: 'error', text: row.message || 'Gagal disimpan' };
  }
  if (row.itemId === '') return { tone: 'warn', text: 'Item belum dipilih' };
  if (row.buId === '') return { tone: 'warn', text: 'Business Unit belum dipilih' };
  if (row.locationId === '') return { tone: 'warn', text: 'Lokasi belum dipilih' };
  if (!isIsoDate(row.testDate)) return { tone: 'warn', text: 'Tanggal uji belum diisi' };
  return { tone: 'ok', text: '' };
}

const TONE_CLASS = {
  error: 'text-destructive',
  warn: 'text-amber-600 dark:text-amber-400',
  ok: 'text-muted-foreground',
} as const;

function stickerSummary(row: StagingRow): string {
  if (row.stickers === null) return 'Semua stiker yang berlaku';
  if (row.stickers.length === 0) return 'Tanpa stiker';
  return row.stickers.map((sticker) => `${sticker.name} ×${sticker.qty}`).join(', ');
}

interface SerialCellProps {
  clientId: string;
  serial: string;
  onCommitSerial: StagingTableProps['onCommitSerial'];
  disabled: boolean;
}

/** Sel serial: dinormalisasi saat keluar sel; serial ganda di tabel atau tak sah ditolak dan nilai lama dikembalikan. */
function SerialCell({ clientId, serial, onCommitSerial, disabled }: SerialCellProps) {
  const [text, setText] = useState(serial);
  const [error, setError] = useState<string | null>(null);
  // Nilai berubah dari luar (mis. dipulihkan): ikuti.
  const [seen, setSeen] = useState(serial);
  if (seen !== serial) {
    setSeen(serial);
    setText(serial);
  }
  function commit() {
    const normalized = normalizeSerial(text);
    if (normalized === serial) {
      setText(serial);
      setError(null);
      return;
    }
    const problem = serialProblem(normalized);
    const message =
      problem === 'empty'
        ? 'Serial tidak boleh kosong'
        : problem !== null
          ? 'Serial tidak sah'
          : onCommitSerial(clientId, normalized);
    if (message !== null) {
      setError(message);
      setText(serial);
      return;
    }
    setError(null);
    setText(normalized);
  }
  return (
    <div>
      <Input
        aria-label={`Serial ${serial}`}
        aria-invalid={error ? true : undefined}
        className="h-8 w-44 font-mono"
        value={text}
        disabled={disabled}
        maxLength={SERIAL_LIMITS.serialMax * 4}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
      {error ? (
        <p role="alert" className="mt-0.5 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface RowViewProps extends Omit<StagingTableProps, 'rows' | 'onSelectAll' | 'disabled'> {
  disabled: boolean;
  row: StagingRow;
  index: number;
}

const RowView = memo(function RowView({
  row,
  index,
  onSelect,
  onEdit,
  onCommitSerial,
  onOpenDetail,
  onRemove,
  disabled,
}: RowViewProps) {
  const status = rowStatus(row);
  return (
    <tr
      data-result={row.result ?? (status.tone === 'ok' ? 'ok' : 'incomplete')}
      className={cn(
        'border-b align-top',
        status.tone === 'error' && 'bg-destructive/5',
        status.tone === 'warn' && 'bg-amber-500/5',
        row.selected && 'bg-muted/50',
      )}
    >
      <td className="px-2 py-1.5">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          aria-label={`Pilih baris ${row.serial}`}
          checked={row.selected}
          disabled={disabled}
          onChange={(event) => onSelect(row.clientId, event.target.checked)}
        />
      </td>
      <td className="px-2 py-1.5 text-xs text-muted-foreground tabular-nums">{index + 1}</td>
      <td className="px-2 py-1">
        <SerialCell
          clientId={row.clientId}
          serial={row.serial}
          onCommitSerial={onCommitSerial}
          disabled={disabled}
        />
      </td>
      <td className="max-w-48 px-2 py-1.5 text-sm">
        <span className="block truncate" title={row.itemLabel}>
          {row.itemLabel || '—'}
        </span>
        {row.buLabel ? <span className="text-xs text-muted-foreground">{row.buLabel}</span> : null}
      </td>
      <td className="px-2 py-1">
        <Input
          type="date"
          aria-label={`Tanggal uji ${row.serial}`}
          className="h-8 w-36"
          value={row.testDate}
          disabled={disabled}
          onChange={(event) => onEdit(row.clientId, { testDate: event.target.value })}
        />
      </td>
      <td className="max-w-40 px-2 py-1.5 text-sm">
        <span className="block truncate" title={row.locationLabel}>
          {row.locationLabel || '—'}
        </span>
      </td>
      <td className="px-2 py-1.5">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          aria-label={`Sample ${row.serial}`}
          checked={row.sample}
          disabled={disabled}
          onChange={(event) => onEdit(row.clientId, { sample: event.target.checked })}
        />
      </td>
      <td className="px-2 py-1">
        <Input
          aria-label={`Catatan ${row.serial}`}
          className="h-8 w-44"
          value={row.note}
          disabled={disabled}
          maxLength={SERIAL_LIMITS.noteMax}
          onChange={(event) => onEdit(row.clientId, { note: event.target.value })}
        />
      </td>
      <td className="max-w-48 px-2 py-1.5 text-xs text-muted-foreground">
        <span className="block truncate" title={stickerSummary(row)}>
          {stickerSummary(row)}
        </span>
      </td>
      <td className={cn('min-w-40 px-2 py-1.5 text-xs', TONE_CLASS[status.tone])}>{status.text}</td>
      <td className="whitespace-nowrap px-2 py-1 text-right">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Detail ${row.serial}`}
          disabled={disabled}
          onClick={() => onOpenDetail(row.clientId)}
        >
          Detail
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Hapus ${row.serial}`}
          disabled={disabled}
          onClick={() => onRemove(row.clientId)}
        >
          Hapus
        </Button>
      </td>
    </tr>
  );
});

/** Tabel sementara hasil pindai/tempel; sel dapat diedit, kolom Hasil memberi tanda warna per baris. */
export function StagingTable({
  rows,
  onSelect,
  onSelectAll,
  onEdit,
  onCommitSerial,
  onOpenDetail,
  onRemove,
  disabled = false,
}: StagingTableProps) {
  const allSelected = rows.length > 0 && rows.every((row) => row.selected);
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-left">
        <caption className="sr-only">Draft serial yang akan disimpan</caption>
        <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-2 py-2">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                aria-label="Pilih semua baris"
                checked={allSelected}
                disabled={disabled}
                onChange={(event) => onSelectAll(event.target.checked)}
              />
            </th>
            <th scope="col" className="px-2 py-2 font-medium">
              #
            </th>
            <th scope="col" className="px-2 py-2 font-medium">
              Serial
            </th>
            <th scope="col" className="px-2 py-2 font-medium">
              Item
            </th>
            <th scope="col" className="px-2 py-2 font-medium">
              Tanggal uji
            </th>
            <th scope="col" className="px-2 py-2 font-medium">
              Lokasi
            </th>
            <th scope="col" className="px-2 py-2 font-medium">
              Sample
            </th>
            <th scope="col" className="px-2 py-2 font-medium">
              Catatan
            </th>
            <th scope="col" className="px-2 py-2 font-medium">
              Stiker
            </th>
            <th scope="col" className="px-2 py-2 font-medium">
              Hasil
            </th>
            <th scope="col" className="px-2 py-2">
              <span className="sr-only">Aksi</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <RowView
              key={row.clientId}
              row={row}
              index={index}
              onSelect={onSelect}
              onEdit={onEdit}
              onCommitSerial={onCommitSerial}
              onOpenDetail={onOpenDetail}
              onRemove={onRemove}
              disabled={disabled}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
