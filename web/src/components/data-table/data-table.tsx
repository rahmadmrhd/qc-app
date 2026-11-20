import { cn } from 'cn';
import type { ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useIsDesktop } from '@/hooks/use-is-desktop';
import { type RowAction, RowActions } from './row-actions';
import type { RowSelection } from './use-row-selection';

export interface DataColumn<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: 'left' | 'right';
  className?: string;
}

export interface DataTableProps<T> {
  rows: readonly T[];
  rowKey: (row: T) => string;
  columns: readonly DataColumn<T>[];
  /** Nama aksesibel tabel. */
  label: string;
  /** Nama baris untuk checkbox dan menu aksi ponsel (bawaan: kunci baris). */
  selectLabel?: (row: T) => string;
  actions?: (row: T) => readonly RowAction[];
  selection?: RowSelection;
  empty?: ReactNode;
  isError?: boolean;
  isLoading?: boolean;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
}

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
  isLoading,
  hasMore,
  loadingMore,
  onLoadMore,
}: DataTableProps<T>) {
  const desktop = useIsDesktop();
  const nameOf = (row: T) => selectLabel?.(row) ?? rowKey(row);

  if (isError) {
    return <Alert color="destructive">Gagal memuat data. Coba muat ulang.</Alert>;
  }

  const ids = rows.map(rowKey);
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
                  className="data-[state=selected]:bg-info-text/8"
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
                        stickyFirst && index === 0 && 'sticky left-0 z-[1] bg-background',
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
      {hasMore ? (
        <div className="flex justify-center">
          <Button type="button" variant="outline" disabled={loadingMore} onClick={onLoadMore}>
            {loadingMore ? 'Memuat…' : 'Muat lebih banyak'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
