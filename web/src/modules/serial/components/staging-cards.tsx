import { memo, useMemo } from 'react';
import {
  LongPressHint,
  SelectionBar,
  StartSelectButton,
} from '@/components/data-table/selection-bar';
import { useLongPressSelect } from '@/components/data-table/use-long-press-select';
import type { RowSelection } from '@/components/data-table/use-row-selection';
import { AttachmentView } from '@/components/file-dialog';
import type { UploadEntry } from '@/components/file-dialog/use-background-uploads';
import { MobileCard } from '@/components/mobile/mobile-card';
import { cn } from '@/lib/utils';
import type { StagingRow } from '../lib/draft';
import { RowBadges, rowStatus, type StagingTableProps, TONE_CLASS } from './staging-table';

export type StagingCardsProps = Pick<
  StagingTableProps,
  'rows' | 'onSelect' | 'onSelectAll' | 'onOpenDetail' | 'disabled'
> & {
  /** Unggahan foto bukti yang berjalan/gagal; tiap kartu menampilkan milik barisnya dengan Ulangi/Buang/Batalkan. */
  uploadEntries?: readonly UploadEntry[];
  onRetryUpload?: (key: string) => void;
  onCancelUpload?: (key: string) => void;
};

const NO_UPLOADS: readonly UploadEntry[] = [];

interface CardViewProps {
  row: StagingRow;
  index: number;
  onSelect: StagingTableProps['onSelect'];
  onOpenDetail: StagingTableProps['onOpenDetail'];
  disabled: boolean;
  /** Mode pilih (tekan lama): kotak centang tampil dan ketukan kartu mengubah pilihan. */
  selecting: boolean;
  bind: (id: string) => object;
  uploads: readonly UploadEntry[];
  onRetryUpload: ((key: string) => void) | undefined;
  onCancelUpload: ((key: string) => void) | undefined;
}

const CardView = memo(function CardView({
  row,
  index,
  onSelect,
  onOpenDetail,
  disabled,
  selecting,
  bind,
  uploads,
  onRetryUpload,
  onCancelUpload,
}: CardViewProps) {
  const status = rowStatus(row);
  const place = [row.locationLabel, row.testDate].filter((part) => part !== '').join(' · ');
  const itemLine = [row.itemLabel, row.buLabel].filter((part) => part !== '').join(' · ');
  return (
    <MobileCard
      selected={row.selected}
      tone={status.tone === 'error' ? 'error' : status.tone === 'warn' ? 'warn' : undefined}
      rootProps={{
        'data-tour': 'serial-row',
        'data-result': row.result ?? (status.tone === 'ok' ? 'ok' : 'incomplete'),
        className: 'select-none [-webkit-touch-callout:none]',
        ...bind(row.clientId),
      }}
      leading={
        selecting ? (
          <input
            type="checkbox"
            className="size-5 shrink-0 accent-primary"
            data-tour="serial-row-select"
            aria-label={`Pilih baris ${row.serial}`}
            checked={row.selected}
            disabled={disabled}
            onChange={(event) => onSelect(row.clientId, event.target.checked)}
          />
        ) : undefined
      }
      title={
        <button
          type="button"
          aria-label={`Ubah baris ${row.serial}`}
          // Nama tombol (aria-label) menimpa isinya: status masalah dibacakan lewat deskripsi, kartu siap tanpa deskripsi.
          aria-describedby={status.tone === 'ok' ? undefined : `row-status-${row.clientId}`}
          disabled={disabled}
          className="block w-full min-w-0 space-y-1 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-70"
          onClick={() => onOpenDetail(row.clientId)}
        >
          <span className="flex items-baseline gap-2">
            <span className="text-xs text-muted-foreground tabular-nums">{index + 1}</span>
            <span className="min-w-0 break-all font-mono text-sm font-semibold">{row.serial}</span>
          </span>
          <span className="block text-sm">{itemLine || '—'}</span>
          <span className="block text-xs text-muted-foreground">{place || '—'}</span>
          {/* Lencana status hanya untuk baris yang perlu ditinjau; kartu siap tidak membawa teks status. */}
          {status.tone !== 'ok' || row.proofPhotos.length > 0 ? (
            <span className="flex flex-wrap items-center gap-1 text-xs">
              {status.tone !== 'ok' ? (
                <span
                  id={`row-status-${row.clientId}`}
                  className={cn(
                    'rounded-full border px-1.5 py-px font-medium',
                    TONE_CLASS[status.tone],
                  )}
                >
                  {status.text}
                </span>
              ) : null}
              {row.proofPhotos.length > 0 ? (
                <span className="rounded-full border px-1.5 py-px text-muted-foreground">
                  {row.proofPhotos.length} foto
                </span>
              ) : null}
            </span>
          ) : null}
          <RowBadges row={row} />
        </button>
      }
      footer={
        // Di luar tombol (tombol tak boleh bersarang): unggahan baris ini dapat diulang/dibuang/dibatalkan.
        uploads.length > 0 ? (
          <AttachmentView
            items={[]}
            pending={uploads}
            layout="list"
            label={`foto ${row.serial}`}
            disabled={disabled}
            onRetry={onRetryUpload}
            onCancel={onCancelUpload}
          />
        ) : undefined
      }
    />
  );
});

/**
 * Draft sebagai daftar kartu (layar < 768 px): tanpa scroll horizontal; mengetuk kartu membuka dialog "Ubah baris".
 * Memilih beberapa baris = tekan lama kartu (mode pilih: kotak centang, ketuk = ubah pilihan, "Pilih semua" di header
 * mode pilih); hapus lewat bar aksi pilihan atau dialog.
 */
export function StagingCards({
  rows,
  onSelect,
  onSelectAll,
  onOpenDetail,
  disabled = false,
  uploadEntries,
  onRetryUpload,
  onCancelUpload,
}: StagingCardsProps) {
  // Adaptor ke `RowSelection` agar mode pilih tahan-lama kit dipakai ulang (pilihan sebenarnya tetap di baris draft).
  const selection = useMemo<RowSelection>(() => {
    const selected = new Set(rows.filter((row) => row.selected).map((row) => row.clientId));
    return {
      selected,
      count: selected.size,
      toggle: (id) => onSelect(id, !selected.has(id)),
      setAll: (_ids, on) => onSelectAll(on),
      remove: () => undefined,
      clear: () => onSelectAll(false),
    };
  }, [rows, onSelect, onSelectAll]);
  const ids = useMemo(() => rows.map((row) => row.clientId), [rows]);
  const { selecting, bind, enter, exit } = useLongPressSelect(
    disabled ? undefined : selection,
    true,
  );
  const uploadsByRow = useMemo(() => {
    const byRow = new Map<string, UploadEntry[]>();
    for (const entry of uploadEntries ?? []) {
      const list = byRow.get(entry.owner);
      if (list) list.push(entry);
      else byRow.set(entry.owner, [entry]);
    }
    return byRow;
  }, [uploadEntries]);
  return (
    <div className="space-y-2">
      {selecting ? <SelectionBar selection={selection} ids={ids} onExit={exit} /> : null}
      {!selecting && !disabled && rows.length > 0 ? (
        <>
          <StartSelectButton label="Pilih baris draft" onStart={enter} tour="serial-row-select" />
          <LongPressHint />
        </>
      ) : null}
      <ul aria-label="Draft serial yang akan disimpan" className="space-y-2">
        {rows.map((row, index) => (
          <CardView
            key={row.clientId}
            row={row}
            index={index}
            onSelect={onSelect}
            onOpenDetail={onOpenDetail}
            disabled={disabled}
            selecting={selecting}
            bind={bind}
            uploads={uploadsByRow.get(row.clientId) ?? NO_UPLOADS}
            onRetryUpload={onRetryUpload}
            onCancelUpload={onCancelUpload}
          />
        ))}
      </ul>
    </div>
  );
}
