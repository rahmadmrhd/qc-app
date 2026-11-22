import { type LinkProps, useNavigate } from '@tanstack/react-router';
import { cn } from 'cn';
import type { ReactNode } from 'react';
import { ListState } from '@/components/page/list-state';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useIsDesktop } from '@/hooks/use-is-desktop';
import { DataCards } from './data-cards';
import { type RowAction, RowActions } from './row-actions';
import { type RowSelection, usePruneSelection } from './use-row-selection';

/**
 * Peran kolom di tampilan kartu ponsel (< 768 px): `title` = judul kartu (tautan), `badge` = lencana status di bawah
 * judul, `meta` = pasangan label (header kolom) dan nilai, `hide` = tak ditampilkan di kartu. Bawaan: kolom pertama
 * = `title` (bila tak ada kolom ber-`title`), kolom berid `status` = `badge`, selebihnya `meta`.
 */
export type MobileRole = 'title' | 'badge' | 'meta' | 'hide';

export interface DataColumn<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: 'left' | 'right';
  className?: string;
  /** Peran di kartu ponsel; lihat `MobileRole`. */
  mobile?: MobileRole;
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
  /** Ada filter/pencarian aktif: kosong berarti "tidak cocok" (dengan tombol hapus filter bila `onClearFilters` ada). */
  filtered?: boolean;
  onClearFilters?: () => void;
  /** Ajakan aksi pada keadaan kosong biasa (mis. tombol Tambah). */
  emptyAction?: ReactNode;
  /**
   * Baris yang boleh dipilih (bawaan: semua). Baris yang tidak boleh dipilih tanpa checkbox (tabel) dan tak ikut
   * "Pilih semua", mis. jenis sistem yang tak dapat diubah massal. Hanya berarti bila ada `selection`.
   */
  rowSelectable?: (row: T) => boolean;
  /**
   * Tujuan View baris (B9): di ponsel (kartu) klik badan kartu menavigasi ke sini (tautan judul tetap jalan keyboard).
   * `null` = baris tanpa halaman View. Desktop tak berubah (nilai kolom tetap `LinkCell`).
   */
  rowTo?: (row: T) => RowTarget | null;
  /** Aksi klik badan kartu selain navigasi (mis. buka dialog); `rowTo` menang bila keduanya ada. */
  onOpen?: (row: T) => void;
}

export interface RowTarget {
  to: LinkProps['to'];
  params?: Record<string, string>;
  search?: Record<string, unknown>;
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
 * Daftar data kit CRUD. Di >= 768 px tabel TANPA pembungkus gulir horizontal agar header `sticky` mengikuti bar
 * headroom; di < 768 px kartu bertumpuk (`DataCards`; peran kolom lewat `DataColumn.mobile`). Hanya salah satu
 * yang dirender pada satu waktu.
 */
export function DataTable<T>(props: DataTableProps<T>) {
  // `useNavigate` hanya dipanggil bila `rowTo` dipakai (komponen terpisah), jadi tabel tanpa `rowTo` tak butuh router.
  return props.rowTo ? <RouterDataTable {...props} /> : <DataTableImpl {...props} />;
}

function RouterDataTable<T>(props: DataTableProps<T>) {
  const navigate = useNavigate();
  const { rowTo } = props;
  const open = (row: T) => {
    const target = rowTo?.(row);
    if (!target) return;
    void navigate({
      to: target.to,
      params: target.params as never,
      search: target.search as never,
    } as never);
  };
  return <DataTableImpl {...props} onOpen={open} />;
}

function DataTableImpl<T>({
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
  filtered,
  onClearFilters,
  emptyAction,
  rowSelectable,
  rowTo,
  onOpen,
}: DataTableProps<T>) {
  const desktop = useIsDesktop();
  const nameOf = (row: T) => selectLabel?.(row) ?? rowKey(row);
  const isSelectable = (row: T) => rowSelectable?.(row) ?? true;
  const ids = rows.map(rowKey);
  const selectableIds = rows.filter(isSelectable).map(rowKey);
  usePruneSelection(selection, ids, !isLoading);

  const selectedCount = selection
    ? selectableIds.filter((id) => selection.selected.has(id)).length
    : 0;
  const allSelected = selectableIds.length > 0 && selectedCount === selectableIds.length;
  const someSelected = selectedCount > 0 && !allSelected;

  const table = (
    <table aria-label={label} className="w-full caption-bottom text-sm">
      <TableHeader>
        <TableRow className="hover:bg-muted">
          {selection ? (
            <TableHead className={cn(HEAD_STICKY, 'w-px')}>
              <Checkbox
                aria-label="Pilih semua"
                checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                onCheckedChange={() => selection.setAll(selectableIds, !allSelected)}
              />
            </TableHead>
          ) : null}
          {actions ? <TableHead className={cn(HEAD_STICKY, 'w-px')}>Aksi</TableHead> : null}
          {columns.map((column) => (
            <TableHead
              key={column.id}
              className={cn(
                HEAD_STICKY,
                column.align === 'right' && 'text-right',
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
                      {isSelectable(row) ? (
                        <Checkbox
                          aria-label={`Pilih ${nameOf(row)}`}
                          checked={isSelected}
                          onCheckedChange={() => selection.toggle(id)}
                        />
                      ) : null}
                    </TableCell>
                  ) : null}
                  {actions ? (
                    <TableCell className="w-px">
                      <RowActions name={nameOf(row)} actions={actions(row)} />
                    </TableCell>
                  ) : null}
                  {columns.map((column) => (
                    <TableCell
                      key={column.id}
                      className={cn(column.align === 'right' && 'text-right', column.className)}
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
      <ListState
        isError={isError}
        onRetry={onRetry}
        isEmpty={rows.length === 0 && (!isLoading || Boolean(isError))}
        filtered={filtered}
        onClearFilters={onClearFilters}
        empty={empty}
        emptyAction={emptyAction}
      >
        {desktop ? (
          <div className="rounded-lg border">{table}</div>
        ) : (
          <DataCards
            rows={rows}
            rowKey={rowKey}
            columns={columns}
            label={label}
            nameOf={nameOf}
            selection={selection}
            isSelectable={isSelectable}
            actions={actions}
            isLoading={isLoading}
            openOf={(row) => (onOpen && (!rowTo || rowTo(row)) ? () => onOpen(row) : undefined)}
          />
        )}
      </ListState>
      {loadMoreError ? (
        <Alert color="destructive" className="flex flex-wrap items-center gap-2">
          <span>Gagal memuat halaman berikutnya.</span>
          <Button type="button" size="sm" variant="outline" color="primary" onClick={onLoadMore}>
            Coba lagi
          </Button>
        </Alert>
      ) : hasMore ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            color="primary"
            disabled={loadingMore}
            onClick={onLoadMore}
          >
            {loadingMore ? 'Memuat…' : 'Muat lebih banyak'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
