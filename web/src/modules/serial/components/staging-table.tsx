import {
  isIsoDate,
  normalizeSerial,
  SERIAL_LIMITS,
  SERIAL_PROOF_LIMITS,
  serialProblem,
} from '@shared/serials';
import { memo, useMemo, useState } from 'react';
import type { UploadEntry } from '@/components/file-dialog/use-background-uploads';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { existingBuProblem, existingProblem, type StagingRow } from '../lib/draft';
import { noteSummary } from '../lib/note-summary';
import type { StampPreviewInput } from '../lib/stamp-preview';
import { type ProofFieldUploads, ProofPhotoField } from './proof-photo-field';

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
  /** Nama pelaku untuk pratinjau cap di kamera foto (dari akun yang masuk); kosong = tanpa pratinjau cap. */
  actorName?: string;
  /** Unggahan foto bukti yang berjalan/gagal (semua baris; dikelompokkan per `clientId` baris di sini). */
  uploadEntries: readonly UploadEntry[];
  /** Mengantrekan berkas foto bukti untuk satu baris (hook unggah dipegang halaman). */
  onUploadFiles: (clientId: string, files: Parameters<ProofFieldUploads['add']>[0]) => void;
  onRetryUpload: (key: string) => void;
  onCancelUpload: (key: string) => void;
}

const NO_UPLOADS: readonly UploadEntry[] = [];

/** Penanda sebuah baris: hasil dari server, rujukan yang harus dipilih ulang, atau kolom wajib yang kosong. */
export function rowStatus(row: StagingRow): { tone: 'error' | 'warn' | 'ok'; text: string } {
  if (row.unresolved && row.unresolved.length > 0) {
    const names = row.unresolved.map((key) =>
      key === 'item' ? 'item' : key === 'location' ? 'lokasi' : 'stiker',
    );
    return { tone: 'error', text: `Pilih ulang ${names.join(', ')} (tidak ditemukan)` };
  }
  // Baris Cek ulang yang serialnya punya laporan aktif atau sudah Rusak: tidak dapat disimpan dari Catat.
  const blocked = existingProblem(row);
  if (blocked !== null) return { tone: 'error', text: blocked };
  if (row.result === 'duplicate') {
    return { tone: 'warn', text: row.message || 'Serial sudah terdaftar' };
  }
  if (row.result === 'invalid' || row.result === 'error') {
    return { tone: 'error', text: row.message || 'Gagal disimpan' };
  }
  if (row.itemId === '') return { tone: 'warn', text: 'Item belum dipilih' };
  const buProblem = existingBuProblem(row);
  if (buProblem !== null) return { tone: 'error', text: buProblem };
  if (row.buId === '') return { tone: 'warn', text: 'Business Unit belum dipilih' };
  if (row.locationId === '') return { tone: 'warn', text: 'Lokasi belum dipilih' };
  if (!isIsoDate(row.testDate)) return { tone: 'warn', text: 'Tanggal uji belum diisi' };
  const needed = (row.proofMin ?? 0) - row.proofPhotos.length;
  if (needed > 0) return { tone: 'error', text: `Butuh ${needed} foto lagi` };
  return { tone: 'ok', text: '' };
}

export const TONE_CLASS = {
  error: 'text-destructive-text',
  warn: 'text-warning-text',
  ok: 'text-muted-foreground',
} as const;

/** Ringkasan pilihan stiker eksplisit; `null` (bawaan semua yang berlaku) tidak punya ringkasan. */
export function stickerSummary(row: StagingRow): string | null {
  if (row.stickers === null) return null;
  if (row.stickers.length === 0) return 'Tanpa stiker';
  return row.stickers.map((sticker) => `${sticker.name} ×${sticker.qty}`).join(', ');
}

interface SerialCellProps {
  clientId: string;
  serial: string;
  onCommitSerial: StagingTableProps['onCommitSerial'];
  disabled: boolean;
  /** Serial dari perangkat (hasil inject Country Lock): hanya dibaca, tidak dapat diubah di tabel. */
  locked: boolean;
}

/** Sel serial: dinormalisasi saat keluar sel; serial ganda di tabel atau tak sah ditolak dan nilai lama dikembalikan. */
function SerialCell({ clientId, serial, onCommitSerial, disabled, locked }: SerialCellProps) {
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
  if (locked) {
    return (
      <span
        title="Serial dari perangkat, tidak dapat diubah"
        className="block h-8 w-36 truncate px-2 font-mono text-sm leading-8"
      >
        {serial}
      </span>
    );
  }
  return (
    <div>
      <Input
        aria-label={`Serial ${serial}`}
        aria-invalid={error ? true : undefined}
        className="h-8 w-36 font-mono"
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
        <p role="alert" className="mt-0.5 text-xs text-destructive-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Lencana kecil untuk kolom yang tidak punya sel sendiri: Cek ulang (serial sudah tercatat; plus perpindahan BU bila
 * BU baris beda dari BU saat ini), Sample, pilihan stiker eksplisit, dan catatan.
 */
export function RowBadges({ row }: { row: StagingRow }) {
  const stickers = stickerSummary(row);
  // Catatan berbentuk Markdown: tabel dan kartu hanya menampilkan ringkasan teks polosnya.
  const note = noteSummary(row.note);
  const existing = row.existing;
  if (!existing && !row.sample && stickers === null && note === '') return null;
  const moving = existing && row.buId !== '' && row.buId !== existing.buId;
  return (
    <span className="mt-0.5 flex flex-wrap gap-1 text-xs text-muted-foreground">
      {existing ? (
        <span
          className="rounded-full border border-primary/50 bg-primary/10 px-1.5 py-px font-medium text-foreground"
          title={`Serial sudah tercatat di ${existing.buCode}; entri ini menjadi cek ulang`}
        >
          Cek ulang
        </span>
      ) : null}
      {existing && moving ? (
        <span className="rounded-full border px-1.5 py-px text-foreground">
          Pindah BU: {existing.buCode} → {row.buLabel}
        </span>
      ) : null}
      {row.sample ? (
        <span className="rounded-full border px-1.5 py-px text-foreground">Sample</span>
      ) : null}
      {stickers !== null ? (
        <span className="rounded-full border px-1.5 py-px">{stickers}</span>
      ) : null}
      {note !== '' ? (
        <span className="max-w-full truncate rounded-full border px-1.5 py-px" title={note}>
          Catatan: {note}
        </span>
      ) : null}
    </span>
  );
}

interface RowViewProps
  extends Omit<
    StagingTableProps,
    'rows' | 'onSelectAll' | 'disabled' | 'actorName' | 'uploadEntries'
  > {
  actorName: string;
  disabled: boolean;
  row: StagingRow;
  index: number;
  /** Unggahan baris ini saja (identitas tetap bila tak berubah, agar `memo` tidak menggambar ulang baris lain). */
  uploads: readonly UploadEntry[];
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
  actorName,
  uploads,
  onUploadFiles,
  onRetryUpload,
  onCancelUpload,
}: RowViewProps) {
  const status = rowStatus(row);
  const clientId = row.clientId;
  const rowUploads = useMemo<ProofFieldUploads>(
    () => ({
      entries: uploads,
      add: (files) => onUploadFiles(clientId, files),
      retry: onRetryUpload,
      remove: onCancelUpload,
    }),
    [uploads, clientId, onUploadFiles, onRetryUpload, onCancelUpload],
  );
  // Data cap dari kolom baris (primitif, jadi baris `memo` lain tak ikut dirender ulang).
  const stamp = useMemo<StampPreviewInput | undefined>(
    () =>
      actorName === ''
        ? undefined
        : {
            serial: row.serial,
            itemLabel: row.itemLabel,
            buLabel: row.buLabel,
            locationLabel: row.locationLabel,
            actorName,
            actorTeam: 'QC',
          },
    [row.serial, row.itemLabel, row.buLabel, row.locationLabel, actorName],
  );
  return (
    <tr
      data-tour="serial-row"
      data-result={row.result ?? (status.tone === 'ok' ? 'ok' : 'incomplete')}
      className={cn(
        'border-b align-top',
        status.tone === 'error' && 'bg-destructive/5',
        status.tone === 'warn' && 'bg-warning-text/5',
        row.selected && 'bg-muted/50',
      )}
    >
      <td className="px-2 py-1.5">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          data-tour="serial-row-select"
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
          locked={row.source === 'countrylock'}
        />
      </td>
      <td className="max-w-44 px-2 py-1.5 text-sm">
        <span className="block truncate" title={row.itemLabel}>
          {row.itemLabel || '—'}
        </span>
        {row.buLabel ? <span className="text-xs text-muted-foreground">{row.buLabel}</span> : null}
        <RowBadges row={row} />
      </td>
      <td className="max-w-44 px-2 py-1">
        <span className="block truncate text-sm" title={row.locationLabel}>
          {row.locationLabel || '—'}
        </span>
        <Input
          type="date"
          aria-label={`Tanggal uji ${row.serial}`}
          className="mt-1 h-8 w-36"
          value={row.testDate}
          disabled={disabled}
          onChange={(event) => onEdit(row.clientId, { testDate: event.target.value })}
        />
      </td>
      <td className="min-w-24 px-2 py-1.5">
        <ProofPhotoField
          value={row.proofPhotos}
          uploads={rowUploads}
          max={SERIAL_PROOF_LIMITS.perEntryMax}
          disabled={disabled}
          label={row.serial}
          stamp={stamp}
          onChange={(proofPhotos) => onEdit(row.clientId, { proofPhotos })}
        />
      </td>
      <td className={cn('min-w-28 px-2 py-1.5 text-xs', TONE_CLASS[status.tone])}>{status.text}</td>
      <td className="whitespace-nowrap px-2 py-1 text-right" data-tour="serial-row-actions">
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
  actorName = '',
  uploadEntries,
  onUploadFiles,
  onRetryUpload,
  onCancelUpload,
}: StagingTableProps) {
  const allSelected = rows.length > 0 && rows.every((row) => row.selected);
  const uploadsByRow = useMemo(() => {
    const grouped = new Map<string, UploadEntry[]>();
    for (const entry of uploadEntries) {
      const list = grouped.get(entry.owner);
      if (list) list.push(entry);
      else grouped.set(entry.owner, [entry]);
    }
    return grouped;
  }, [uploadEntries]);
  return (
    <div className="relative overflow-x-auto rounded-md border">
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
              Lokasi dan tanggal uji
            </th>
            <th scope="col" className="px-2 py-2 font-medium">
              Foto
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
              actorName={actorName}
              uploads={uploadsByRow.get(row.clientId) ?? NO_UPLOADS}
              onUploadFiles={onUploadFiles}
              onRetryUpload={onRetryUpload}
              onCancelUpload={onCancelUpload}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
