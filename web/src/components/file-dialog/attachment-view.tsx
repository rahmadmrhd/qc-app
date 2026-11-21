import { Download, FileText, RotateCcw, X } from 'lucide-react';
import { memo, type ReactNode, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatBytes } from './accept';
import { InlineName } from './inline-name';
import { PreviewDialog } from './preview-dialog';
import type { LibraryItem } from './types';
import { UploadProgress } from './upload-progress';
import type { UploadEntry } from './use-background-uploads';

/** Satu lampiran yang sudah selesai diunggah. Tanpa `renderImage` (mis. PDF) = ikon + tombol Unduh, tanpa pratinjau. */
export interface AttachmentItem {
  id: string;
  name: string;
  mime: string;
  size?: number;
  /** Gambar thumbnail (kisi/daftar) atau besar (pratinjau); pemanggil menentukan sumbernya. */
  renderImage?(variant: 'thumb' | 'large'): ReactNode;
  onDownload?(): void;
}

export interface AttachmentViewProps {
  items: readonly AttachmentItem[];
  /** Unggahan yang masih berjalan atau gagal (dari `useBackgroundUploads`). */
  pending?: readonly UploadEntry[];
  /** `grid` = kisi thumbnail kecil; `list` = satu baris per lampiran. */
  layout: 'grid' | 'list';
  onRemove?(id: string): void;
  /** Dengan ini nama tiap item dapat diubah di tempat (`InlineName`), maks. `nameMax` karakter. */
  onRename?(id: string, name: string): void;
  nameMax?: number;
  onRetry?(key: string): void;
  /** Membuang entri unggahan (berjalan = dibatalkan, gagal = dibuang). */
  onCancel?(key: string): void;
  disabled?: boolean;
  /** Konteks untuk pembaca layar bila ada banyak tampilan serupa di satu halaman. */
  label?: string;
}

/** Adaptor `LibraryItem` (hasil sumber unggah) ke lampiran tampilan; gambar dimuat dari `thumbUrl`/`previewUrl`. */
export function libraryItemToAttachment(item: LibraryItem): AttachmentItem {
  return {
    id: item.id,
    name: item.name,
    mime: 'image/*',
    size: item.size,
    renderImage: (variant) => (
      <img
        src={variant === 'thumb' ? item.thumbUrl : item.previewUrl}
        alt={item.name}
        loading={variant === 'thumb' ? 'lazy' : undefined}
        className={
          variant === 'thumb' ? 'size-full object-cover' : 'max-h-[70dvh] max-w-full object-contain'
        }
      />
    ),
  };
}

interface PendingCellProps {
  entry: UploadEntry;
  layout: 'grid' | 'list';
  disabled?: boolean;
  onRetry?(key: string): void;
  onCancel?(key: string): void;
}

/** Memo: progres XHR memperbarui satu entri tiap event; sel lain tidak ikut dirender ulang. */
const PendingCell = memo(function PendingCell({
  entry,
  layout,
  disabled,
  onRetry,
  onCancel,
}: PendingCellProps) {
  const failed = entry.phase === 'failed';
  return (
    <li
      data-testid="attachment-pending"
      data-phase={entry.phase}
      className={
        layout === 'grid'
          ? 'flex w-40 shrink-0 flex-col gap-1 rounded-md border p-2 text-xs'
          : 'flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm'
      }
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate" title={entry.file.name}>
          {entry.name}
        </span>
        {failed ? (
          <span role="alert" className="text-destructive-text">
            {entry.error ?? 'Gagal mengunggah'}
          </span>
        ) : (
          <UploadProgress phase={entry.phase} fraction={entry.fraction} />
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {failed && onRetry ? (
          <Button
            type="button"
            variant="outline"
            color="primary"
            size="xs"
            aria-label={`Ulangi ${entry.name}`}
            disabled={disabled}
            onClick={() => onRetry(entry.key)}
          >
            <RotateCcw />
            Ulangi
          </Button>
        ) : null}
        {onCancel ? (
          <Button
            type="button"
            variant="ghost"
            color="primary"
            size="xs"
            aria-label={`${failed ? 'Buang' : 'Batalkan'} ${entry.name}`}
            disabled={disabled}
            onClick={() => onCancel(entry.key)}
          >
            {failed ? 'Buang' : 'Batalkan'}
          </Button>
        ) : null}
      </div>
    </li>
  );
});

/**
 * Tampilan lampiran bersama: item selesai (thumbnail; klik membuka pratinjau, PDF = ikon + Unduh), unggahan berjalan
 * (progres), dan unggahan gagal (pesan + Ulangi + Buang).
 */
export function AttachmentView({
  items,
  pending = [],
  layout,
  onRemove,
  onRename,
  nameMax,
  onRetry,
  onCancel,
  disabled,
  label,
}: AttachmentViewProps) {
  const [preview, setPreview] = useState<AttachmentItem | null>(null);
  if (items.length === 0 && pending.length === 0) return null;
  const suffix = label ? `, ${label}` : '';
  const grid = layout === 'grid';
  return (
    <>
      <ul
        data-layout={layout}
        aria-label={label ? `Lampiran ${label}` : 'Lampiran'}
        className={grid ? 'flex flex-wrap gap-2' : 'flex flex-col gap-2'}
      >
        {items.map((item) => {
          const image = item.renderImage;
          return (
            <li
              key={item.id}
              data-testid="attachment-item"
              className={
                grid
                  ? cn('relative shrink-0', onRename && 'w-20')
                  : 'flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm'
              }
            >
              {image ? (
                <button
                  type="button"
                  aria-label={`Perbesar ${item.name}${suffix}`}
                  className="block size-14 shrink-0 cursor-zoom-in overflow-hidden rounded-md border outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  onClick={() => setPreview(item)}
                >
                  {image('thumb')}
                </button>
              ) : (
                <span className="flex size-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-md border bg-muted text-muted-foreground">
                  <FileText aria-hidden className="size-6" />
                  {grid ? (
                    <span className="max-w-full truncate px-1 text-[10px]">{item.name}</span>
                  ) : null}
                </span>
              )}
              {grid && onRename ? (
                <InlineName
                  value={item.name}
                  maxLength={nameMax}
                  readOnly={disabled}
                  className="mt-1 block w-20 text-[11px]"
                  onSave={(name) => onRename(item.id, name)}
                />
              ) : null}
              {grid ? null : (
                <div className="flex min-w-0 flex-1 flex-col">
                  {onRename ? (
                    <InlineName
                      value={item.name}
                      maxLength={nameMax}
                      readOnly={disabled}
                      onSave={(name) => onRename(item.id, name)}
                    />
                  ) : (
                    <span className="truncate" title={item.name}>
                      {item.name}
                    </span>
                  )}
                  {item.size !== undefined ? (
                    <span className="text-xs text-muted-foreground">{formatBytes(item.size)}</span>
                  ) : null}
                </div>
              )}
              {!image && item.onDownload ? (
                <Button
                  type="button"
                  variant="outline"
                  color="primary"
                  size="xs"
                  aria-label={`Unduh ${item.name}${suffix}`}
                  className={grid ? 'mt-1 w-14' : undefined}
                  onClick={item.onDownload}
                >
                  <Download />
                  Unduh
                </Button>
              ) : null}
              {onRemove ? (
                <Button
                  type="button"
                  variant="soft"
                  color="secondary"
                  size="icon-xs"
                  aria-label={`Buang ${item.name}${suffix}`}
                  disabled={disabled}
                  className={grid ? 'absolute -top-1.5 -right-1.5 rounded-full' : 'shrink-0'}
                  onClick={() => onRemove(item.id)}
                >
                  <X />
                </Button>
              ) : null}
            </li>
          );
        })}
        {pending.map((entry) => (
          <PendingCell
            key={entry.key}
            entry={entry}
            layout={layout}
            disabled={disabled}
            onRetry={onRetry}
            onCancel={onCancel}
          />
        ))}
      </ul>
      <PreviewDialog item={preview} onClose={() => setPreview(null)} />
    </>
  );
}
