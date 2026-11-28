import { type LinkProps, useNavigate } from '@tanstack/react-router';
import { cn } from 'cn';
import { type MouseEvent, type ReactNode, useContext, useLayoutEffect, useState } from 'react';
import { isCardOpenClick } from '@/components/mobile/card-open';
import { ListFrameContext } from '@/components/page/list-frame';
import { ListState } from '@/components/page/list-state';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useIsDesktop } from '@/hooks/use-is-desktop';
import { useViewportFit } from '@/lib/viewport-fit';
import { DataCards } from './data-cards';
import { type RowAction, RowActions } from './row-actions';
import { useRangeSelect } from './use-range-select';
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
   * Tujuan View baris (B9): klik badan kartu (ponsel) atau baris (desktop) menavigasi ke sini; tautan, tombol, checkbox,
   * dan menu di dalamnya tak ikut membuka (`isCardOpenClick`), dan tautan judul tetap jalan keyboard. `null` = baris
   * tanpa halaman View.
   */
  rowTo?: (row: T) => RowTarget | null;
  /** Aksi klik badan kartu selain navigasi (mis. buka dialog); `rowTo` menang bila keduanya ada. */
  onOpen?: (row: T) => void;
  /** Baris yang disorot sebentar (mis. hasil scan terakhir): latar hijau lembut; bukan pilihan. */
  rowHighlighted?: (row: T) => boolean;
  /**
   * Nada latar selang-seling per kelompok baris (mis. per kardus pada detail pencatatan Ready): `a` = bawaan, `b` = latar lembut.
   * Ditulis ke atribut `data-box-tone` baris; hanya tampilan tabel desktop.
   */
  rowTone?: (row: T) => 'a' | 'b' | undefined;
  /** Kelas tambahan per baris tabel desktop (mis. batas lebih tegas saat pergantian kardus). */
  rowClassName?: (row: T) => string | undefined;
  /**
   * Desktop: `viewport` = pembungkus gulir dua sumbu setinggi sisa layar (header tetap menempel, scrollbar horizontal
   * selalu terlihat di dasar layar); `content` = hanya gulir horizontal tanpa batas tinggi (tabel yang tertanam di View
   * atau dialog). Bawaan: `viewport` di dalam `ListPage`, selain itu `content`.
   */
  fit?: 'viewport' | 'content';
  /** `fit="viewport"` di dalam halaman yang bleed ke tepi `<main>` (mis. `FormPage` di layar lebar). */
  fitBleed?: boolean;
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

/** Header menempel di atas pembungkus gulir (bukan viewport); kolom checkbox dan Aksi menempel di kiri. */
const HEAD_STICKY = 'sticky top-0 z-20 bg-muted';
const CHECK_COL = 'w-10 min-w-10 max-w-10 px-0';
/** Latar sel yang menempel harus opak agar kolom lain tak tembus; keadaan hover/terpilih dikomposit ke `--background`. */
const STICKY_CELL_BG =
  'bg-background group-data-[box-tone=b]/row:bg-[color-mix(in_oklab,var(--foreground)_9%,var(--background))] group-hover/row:bg-[color-mix(in_oklab,var(--muted)_50%,var(--background))] group-has-aria-expanded/row:bg-[color-mix(in_oklab,var(--muted)_50%,var(--background))] group-data-[state=selected]/row:bg-[color-mix(in_oklab,var(--info-text)_8%,var(--background))] group-data-[highlight]/row:bg-[color-mix(in_oklab,var(--success-text)_15%,var(--background))]';
/**
 * Garis dan bayangan tepi kolom menempel terakhir; bayangan hanya tampil saat tabel tergulir ke kanan. Warna bayangan
 * hitam (bukan `foreground`, yang terang di mode gelap sehingga tampak seperti pita cahaya), lebih pekat di mode gelap.
 */
const STICKY_EDGE =
  "border-r after:pointer-events-none after:absolute after:inset-y-0 after:-right-3 after:w-3 after:bg-linear-to-r after:from-black/10 dark:after:from-black/40 after:to-transparent after:opacity-0 after:content-[''] group-data-[scrolled]/scroller:after:opacity-100";

/**
 * Daftar data kit CRUD. Di >= 768 px tabel di dalam pembungkus gulir (`data-slot="table-scroller"`): gulir horizontal
 * bila kolom tak muat, kolom checkbox dan Aksi menempel di kiri, header menempel di atas; dengan `fit="viewport"`
 * tinggi pembungkus dibatasi sisa layar sehingga gulir vertikal terjadi di dalamnya. Di < 768 px kartu bertumpuk
 * (`DataCards`; peran kolom lewat `DataColumn.mobile`). Hanya salah satu yang dirender pada satu waktu.
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
  rowHighlighted,
  rowTone,
  rowClassName,
  fit: fitProp,
  fitBleed = false,
}: DataTableProps<T>) {
  const desktop = useIsDesktop();
  const inList = useContext(ListFrameContext);
  const fit = fitProp ?? (inList ? 'viewport' : 'content');
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const [scrolled, setScrolled] = useState(false);
  // Konten pengikut di bawah pembungkus (tombol/pesan "muat lebih banyak") dikurangkan dari tinggi.
  const fitHeight = useViewportFit(
    scroller,
    desktop && fit === 'viewport',
    loadMoreError ? 64 : hasMore ? 44 : 0,
    fitBleed,
  );
  // Lebar nyata kolom menempel (checkbox + Aksi) dipakai `scroll-padding-left` agar fokus keyboard tak tertutup kolom itu;
  // Aksi bisa lebih lebar dari perkiraan tetap karena jumlah tombol ikon berbeda per tabel.
  const hasStickyCols = Boolean(selection) || Boolean(actions);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `hasStickyCols` memicu pengukuran ulang saat kolom menempel muncul/hilang
  useLayoutEffect(() => {
    if (!scroller) return;
    const cells = Array.from(scroller.querySelectorAll<HTMLElement>('thead [data-sticky-col]'));
    if (cells.length === 0) {
      scroller.style.removeProperty('--sticky-w');
      return;
    }
    const apply = () => {
      const width = cells.reduce((sum, cell) => sum + cell.offsetWidth, 0);
      scroller.style.setProperty('--sticky-w', `${width}px`);
    };
    apply();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(apply);
    for (const cell of cells) observer.observe(cell);
    return () => observer.disconnect();
  }, [scroller, hasStickyCols]);
  // Aksi klik badan baris/kartu: navigasi `rowTo` (atau `onOpen`); baris tanpa halaman View (`rowTo` null) tak membuka.
  const openOf = (row: T) => (onOpen && (!rowTo || rowTo(row)) ? () => onOpen(row) : undefined);
  const nameOf = (row: T) => selectLabel?.(row) ?? rowKey(row);
  const isSelectable = (row: T) => rowSelectable?.(row) ?? true;
  const ids = rows.map(rowKey);
  const selectableIds = rows.filter(isSelectable).map(rowKey);
  usePruneSelection(selection, ids, !isLoading);
  // Shift-klik memilih rentang baris yang dapat dipilih (5.13); baris tanpa checkbox tak ikut.
  const { checkboxProps } = useRangeSelect({
    ids: selectableIds,
    isSelected: (id) => selection?.selected.has(id) ?? false,
    apply: (rangeIds, on) => {
      selection?.setAll(rangeIds, on);
      return undefined;
    },
  });

  const selectedCount = selection
    ? selectableIds.filter((id) => selection.selected.has(id)).length
    : 0;
  const allSelected = selectableIds.length > 0 && selectedCount === selectableIds.length;
  const someSelected = selectedCount > 0 && !allSelected;

  // Kolom menempel terakhir (menerima garis + bayangan tepi): Aksi, atau checkbox bila tak ada Aksi.
  const lastSticky = actions ? 'actions' : selection ? 'checkbox' : null;
  // Offset Aksi hanya bergantung pada lebar kolom checkbox yang tetap (`CHECK_COL` = 2,5 rem), tanpa pengukuran JS.
  const actionsLeft = selection ? 'left-10' : 'left-0';

  const table = (
    <table
      aria-label={label}
      className="w-full caption-bottom border-separate border-spacing-0 text-sm [&_td]:border-b [&_th]:border-b [&_tbody_tr:last-child_td]:border-b-0"
    >
      <TableHeader>
        <TableRow className="hover:bg-muted">
          {selection ? (
            <TableHead
              data-sticky-col
              className={cn(
                HEAD_STICKY,
                CHECK_COL,
                'left-0 z-30',
                lastSticky === 'checkbox' && STICKY_EDGE,
              )}
            >
              <div className="flex justify-center">
                <Checkbox
                  aria-label="Pilih semua"
                  checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                  onCheckedChange={() => selection.setAll(selectableIds, !allSelected)}
                />
              </div>
            </TableHead>
          ) : null}
          {actions ? (
            <TableHead
              data-sticky-col
              className={cn(HEAD_STICKY, 'z-30 w-px', actionsLeft, STICKY_EDGE)}
            >
              Aksi
            </TableHead>
          ) : null}
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
              // Klik baris membuka halaman detail (seperti kartu di ponsel); tautan, tombol, checkbox, dan menu di dalam
              // baris menangani kliknya sendiri (`isCardOpenClick`), jadi tak ikut membuka.
              const openRow = openOf(row);
              return (
                <TableRow
                  key={id}
                  data-state={isSelected ? 'selected' : undefined}
                  data-highlight={rowHighlighted?.(row) ? '' : undefined}
                  data-box-tone={rowTone?.(row)}
                  className={cn(
                    'group/row transition-colors data-[box-tone=b]:bg-foreground/9 data-[highlight]:bg-success-text/15 data-[state=selected]:bg-info-text/8',
                    openRow && 'cursor-pointer',
                    rowClassName?.(row),
                  )}
                  {...(openRow
                    ? {
                        onClick: (event: MouseEvent<HTMLTableRowElement>) => {
                          if (isCardOpenClick(event)) openRow();
                        },
                      }
                    : {})}
                >
                  {selection ? (
                    <TableCell
                      data-no-open=""
                      className={cn(
                        'sticky left-0 z-10',
                        CHECK_COL,
                        STICKY_CELL_BG,
                        lastSticky === 'checkbox' && STICKY_EDGE,
                      )}
                    >
                      {isSelectable(row) ? (
                        <div className="flex justify-center">
                          <Checkbox
                            aria-label={`Pilih ${nameOf(row)}`}
                            checked={isSelected}
                            onCheckedChange={() => selection.toggle(id)}
                            {...checkboxProps(id)}
                          />
                        </div>
                      ) : null}
                    </TableCell>
                  ) : null}
                  {actions ? (
                    <TableCell
                      data-no-open=""
                      className={cn('sticky z-10 w-px', actionsLeft, STICKY_CELL_BG, STICKY_EDGE)}
                    >
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
          <section
            ref={setScroller}
            data-slot="table-scroller"
            data-fit={fit}
            data-scrolled={scrolled || undefined}
            aria-label={`${label} (dapat digulir)`}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: wilayah gulir harus dapat difokus keyboard (axe: scrollable-region-focusable)
            tabIndex={0}
            style={fitHeight ? { maxHeight: `max(16rem, calc(${fitHeight} - 2px))` } : undefined}
            onScroll={(event) => {
              const next = event.currentTarget.scrollLeft > 0;
              if (next !== scrolled) setScrolled(next);
            }}
            className="group/scroller relative isolate max-w-full scroll-pl-[calc(var(--sticky-w,7rem)+0.5rem)] overflow-auto rounded-lg border focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {table}
          </section>
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
            openOf={openOf}
            isHighlighted={rowHighlighted}
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
