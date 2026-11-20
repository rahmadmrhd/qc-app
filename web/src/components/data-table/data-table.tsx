import { cn } from 'cn';
import type { ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useIsDesktop } from '@/hooks/use-is-desktop';
import { type RowAction, RowActions } from './row-actions';
import { type RowSelection, usePruneSelection } from './use-row-selection';

export interface DataColumn<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: 'left' | 'right';
  className?: string;
}

interface DataTableBase<T> {
  rows: readonly T[];
  rowKey: (row: T) => string;
  columns: readonly DataColumn<T>[];
  /** Nama aksesibel tabel. */
  label: string;
  empty?: ReactNode;
  /**
   * Galat muat AWAL (tanpa data). Galat refetch/halaman berikutnya TIDAK menyembunyikan baris: pemanggil meneruskan
   * `isLoadingError` untuk ini dan `loadMoreError` untuk halaman berikutnya.
   */
  isError?: boolean;
  onRetry?: () => void;
  isLoading?: boolean;
  hasMore?: boolean;
  loadingMore?: boolean;
  /** Gagal memuat halaman berikutnya: pesan + "Coba lagi" (memanggil `onLoadMore`). */
  loadMoreError?: boolean;
  onLoadMore?: () => void;
}

/** `selectLabel` (nama baris untuk checkbox dan menu aksi ponsel) wajib bila ada `selection` atau `actions`. */
export type DataTableProps<T> = DataTableBase<T> &
  (
    | { selectLabel?: (row: T) => string; selection?: undefined; actions?: undefined }
    | {
        selectLabel: (row: T) => string;
        selection?: RowSelection;
        actions?: (row: T) => readonly RowAction[];
      }
  );

const HEAD_STICKY = 'sticky top-[var(--headroom-offset,3.5rem)] z-10 bg-muted';

/**
 * Tabel data kit CRUD. Di >= 768 px TANPA pembungkus gulir horizontal agar header `sticky` mengikuti bar headroom;
 * di < 768 px menggulir horizontal dan kolom data pertama menempel di kiri.
 */
export function DataTable<T>({
  rows,
  rowKey,
  columns,
  label,
  selectLabel,
  actions,
  selection,
  empty = 'Tidak ada data yang cocok.',
  isError,
  onRetry,
  isLoading,
  hasMore,
  loadingMore,
  loadMoreError,
  onLoadMore,
}: DataTableProps<T>) {
  const desktop = useIsDesktop();
  const nameOf = (row: T) => selectLabel?.(row) ?? rowKey(row);
  const ids = rows.map(rowKey);
  usePruneSelection(selection, ids, !isLoading);

  if (isError && rows.length === 0) {
    return (
      <Alert color="destructive" className="flex flex-wrap items-center gap-2">
        <span>Gagal memuat data. Coba muat ulang.</span>
        {onRetry ? (
          <Button type="button" size="sm" variant="outline" onClick={onRetry}>
            Coba lagi
          </Button>
        ) : null}
      </Alert>
    );
  }

  const selectedCount = selection ? ids.filter((id) => selection.selected.has(id)).length : 0;
  const allSelected = ids.length > 0 && selectedCount === ids.length;
  const someSelected = selectedCount > 0 && !allSelected;
  const stickyFirst = !desktop;

  const table = (
    <table aria-label={label} className="w-full caption-bottom text-sm">
      <TableHeader>
        <TableRow className="hover:bg-muted">
          {selection ? (
            <TableHead className={cn(HEAD_STICKY, 'w-px')}>
              <Checkbox
                aria-label="Pilih semua"
                checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                onCheckedChange={() => selection.setAll(ids, !allSelected)}
              />
            </TableHead>
          ) : null}
          {actions ? <TableHead className={cn(HEAD_STICKY, 'w-px')}>Aksi</TableHead> : null}
          {columns.map((column, index) => (
            <TableHead
              key={column.id}
              className={cn(
                HEAD_STICKY,
                column.align === 'right' && 'text-right',
                stickyFirst && index === 0 && 'left-0 z-20',
                column.className,
              )}
            >
              {column.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading
          ? Array.from({ length: 6 }, (_, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: baris kerangka tak berurutan
              <TableRow key={index}>
                <TableCell colSpan={columns.length + (selection ? 1 : 0) + (actions ? 1 : 0)}>
                  <Skeleton className="h-5 w-full" />
                </TableCell>
              </TableRow>
            ))
          : rows.map((row) => {
              const id = rowKey(row);
              const isSelected = selection?.selected.has(id) ?? false;
              return (
                <TableRow
                  key={id}
                  data-state={isSelected ? 'selected' : undefined}
                  className="group/row data-[state=selected]:bg-info-text/8"
                >
                  {selection ? (
                    <TableCell className="w-px">
                      <Checkbox
                        aria-label={`Pilih ${nameOf(row)}`}
                        checked={isSelected}
                        onCheckedChange={() => selection.toggle(id)}
                      />
                    </TableCell>
                  ) : null}
                  {actions ? (
                    <TableCell className="w-px">
                      <RowActions name={nameOf(row)} actions={actions(row)} />
                    </TableCell>
                  ) : null}
                  {columns.map((column, index) => (
                    <TableCell
                      key={column.id}
                      className={cn(
                        column.align === 'right' && 'text-right',
                        stickyFirst &&
                          index === 0 &&
                          'sticky left-0 z-[1] bg-background group-data-[state=selected]/row:bg-[color-mix(in_oklab,var(--color-info-text)_8%,var(--background))]',
                        column.className,
                      )}
                    >
                      {column.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
      </TableBody>
    </table>
  );

  return (
    <div className="space-y-3">
      {!isLoading && rows.length === 0 ? (
        <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
          {empty}
        </div>
      ) : desktop ? (
        <div className="rounded-lg border">{table}</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">{table}</div>
      )}
      {loadMoreError ? (
        <Alert color="destructive" className="flex flex-wrap items-center gap-2">
          <span>Gagal memuat halaman berikutnya.</span>
          <Button type="button" size="sm" variant="outline" onClick={onLoadMore}>
            Coba lagi
          </Button>
        </Alert>
      ) : hasMore ? (
        <div className="flex justify-center">
          <Button type="button" variant="outline" disabled={loadingMore} onClick={onLoadMore}>
            {loadingMore ? 'Memuat…' : 'Muat lebih banyak'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
