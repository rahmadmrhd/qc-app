import { memo } from 'react';
import { cn } from '@/lib/utils';
import type { StagingRow } from '../lib/draft';
import { RowBadges, rowStatus, type StagingTableProps, TONE_CLASS } from './staging-table';

export type StagingCardsProps = Pick<
  StagingTableProps,
  'rows' | 'onSelect' | 'onSelectAll' | 'onOpenDetail' | 'disabled'
>;

interface CardViewProps {
  row: StagingRow;
  index: number;
  onSelect: StagingTableProps['onSelect'];
  onOpenDetail: StagingTableProps['onOpenDetail'];
  disabled: boolean;
}

const CardView = memo(function CardView({
  row,
  index,
  onSelect,
  onOpenDetail,
  disabled,
}: CardViewProps) {
  const status = rowStatus(row);
  const place = [row.locationLabel, row.testDate].filter((part) => part !== '').join(' · ');
  const itemLine = [row.itemLabel, row.buLabel].filter((part) => part !== '').join(' · ');
  return (
    <li
      data-tour="serial-row"
      data-result={row.result ?? (status.tone === 'ok' ? 'ok' : 'incomplete')}
      className={cn(
        'flex items-start gap-3 rounded-lg border p-3',
        status.tone === 'error' && 'border-destructive/40 bg-destructive/5',
        status.tone === 'warn' && 'border-amber-500/40 bg-amber-500/5',
        row.selected && 'bg-muted/60',
      )}
    >
      <input
        type="checkbox"
        className="mt-0.5 size-5 shrink-0 accent-primary"
        data-tour="serial-row-select"
        aria-label={`Pilih baris ${row.serial}`}
        checked={row.selected}
        disabled={disabled}
        onChange={(event) => onSelect(row.clientId, event.target.checked)}
      />
      <button
        type="button"
        aria-label={`Ubah baris ${row.serial}`}
        disabled={disabled}
        className="min-w-0 flex-1 space-y-1 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-70"
        onClick={() => onOpenDetail(row.clientId)}
      >
        <span className="flex items-baseline gap-2">
          <span className="text-xs text-muted-foreground tabular-nums">{index + 1}</span>
          <span className="min-w-0 break-all font-mono text-sm font-semibold">{row.serial}</span>
        </span>
        <span className="block text-sm">{itemLine || '—'}</span>
        <span className="block text-xs text-muted-foreground">{place || '—'}</span>
        <span className="flex flex-wrap items-center gap-1 text-xs">
          {status.tone === 'ok' ? (
            <span className="rounded-full border px-1.5 py-px text-muted-foreground">Siap</span>
          ) : (
            <span
              className={cn(
                'rounded-full border px-1.5 py-px font-medium',
                TONE_CLASS[status.tone],
              )}
            >
              {status.text}
            </span>
          )}
          {row.proofPhotos.length > 0 ? (
            <span className="rounded-full border px-1.5 py-px text-muted-foreground">
              {row.proofPhotos.length} foto
            </span>
          ) : null}
        </span>
        <RowBadges row={row} />
      </button>
    </li>
  );
});

/**
 * Draft sebagai daftar kartu (layar < 768 px): tanpa scroll horizontal; mengetuk kartu membuka dialog "Ubah baris".
 * Kartu tidak membawa tombol kecil yang mudah tertekan; hapus lewat bar aksi pilihan atau dialog.
 */
export function StagingCards({
  rows,
  onSelect,
  onSelectAll,
  onOpenDetail,
  disabled = false,
}: StagingCardsProps) {
  const allSelected = rows.length > 0 && rows.every((row) => row.selected);
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-3 px-1 text-sm text-muted-foreground">
        <input
          type="checkbox"
          className="size-5 accent-primary"
          aria-label="Pilih semua baris"
          checked={allSelected}
          disabled={disabled}
          onChange={(event) => onSelectAll(event.target.checked)}
        />
        Pilih semua
      </label>
      <ul aria-label="Draft serial yang akan disimpan" className="space-y-2">
        {rows.map((row, index) => (
          <CardView
            key={row.clientId}
            row={row}
            index={index}
            onSelect={onSelect}
            onOpenDetail={onOpenDetail}
            disabled={disabled}
          />
        ))}
      </ul>
    </div>
  );
}
