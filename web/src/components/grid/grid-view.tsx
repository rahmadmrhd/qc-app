import { cn } from 'cn';
import type { ReactNode } from 'react';
import { LongPressHint, SelectionBar } from '@/components/data-table/selection-bar';
import { useLongPressSelect } from '@/components/data-table/use-long-press-select';
import { type RowSelection, usePruneSelection } from '@/components/data-table/use-row-selection';
import { useInfiniteSentinel } from '@/components/file-dialog/use-infinite-sentinel';
import { ListState } from '@/components/page/list-state';
import { Spinner } from '@/components/spinner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { useIsDesktop } from '@/hooks/use-is-desktop';

export const GRID_CLASS = 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5';

interface GridViewBase<T> {
  items: readonly T[];
  itemKey: (item: T) => string;
  /** Isi kartu; kartunya sendiri milik pemanggil. */
  renderItem: (item: T) => ReactNode;
  /** Nama aksesibel daftar. */
  label: string;
  isLoading?: boolean;
  isError?: boolean;
  /** Teks galat muat awal. */
  errorText?: string;
  /** Ada filter aktif: kosong = "tidak cocok" dengan tombol hapus filter (lihat `ListState`). */
  filtered?: boolean;
  onClearFilters?: () => void;
  /** Ajakan aksi pada keadaan kosong biasa. */
  emptyAction?: ReactNode;
  onRetry?: () => void;
  empty?: ReactNode;
  hasMore?: boolean;
  loadingMore?: boolean;
  /** Gagal memuat halaman berikutnya: tampil pesan + "Coba lagi" (memanggil `onLoadMore`). */
  loadMoreError?: boolean;
  onLoadMore?: () => void;
  className?: string;
  /** Kelas tambahan per butir (mis. cincin pilihan). */
  itemClassName?: (item: T) => string | undefined;
  /** Peran daftar (bawaan `list`). */
  role?: 'list' | 'radiogroup';
}

/** `selectLabel` wajib bila ada `selection`: tiap kartu mendapat checkbox "Pilih <nama>". */
export type GridViewProps<T> = GridViewBase<T> &
  (
    | { selection?: undefined; selectLabel?: (item: T) => string }
    | { selection: RowSelection; selectLabel: (item: T) => string }
  );

/**
 * Kisi kartu kit CRUD: kerangka, skeleton, keadaan kosong/galat, dan gulir tak terbatas (sentinel
 * `IntersectionObserver` + tombol cadangan bila API-nya tak ada). Kartu tetap milik pemanggil.
 */
export function GridView<T>({
  items,
  itemKey,
  renderItem,
  label,
  isLoading,
  isError,
  errorText = 'Gagal memuat data',
  onRetry,
  empty,
  filtered,
  onClearFilters,
  emptyAction,
  hasMore,
  loadingMore,
  loadMoreError,
  onLoadMore,
  className,
  itemClassName,
  role = 'list',
  selection,
  selectLabel,
}: GridViewProps<T>) {
  usePruneSelection(selection, items.map(itemKey), !isLoading);
  const desktop = useIsDesktop();
  // Ponsel: pilih massal tahan-lama (checkbox hanya tampil di mode pilih); >= 768 px checkbox selalu tampil.
  const { selecting, bind } = useLongPressSelect(selection, !desktop);
  const { ref: sentinelRef, supported } = useInfiniteSentinel({
    enabled: Boolean(hasMore) && !loadingMore && !loadMoreError,
    onVisible: () => onLoadMore?.(),
    resetKey: items.length,
  });

  if (isLoading) {
    return (
      <div className={cn(GRID_CLASS, className)}>
        {Array.from({ length: 10 }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: kerangka statis
          <Skeleton key={index} className="aspect-square" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    // Tanpa teks kosong, tanpa galat, dan tanpa filter: tak ada yang ditampilkan (perilaku lama).
    if (!empty && !emptyAction && !isError && !filtered) return null;
    return (
      <ListState
        isError={isError}
        onRetry={onRetry}
        errorText={errorText}
        isEmpty
        filtered={filtered}
        onClearFilters={onClearFilters}
        empty={empty}
        emptyAction={emptyAction}
      >
        {null}
      </ListState>
    );
  }

  return (
    <>
      {selection && selecting ? (
        <SelectionBar selection={selection} ids={items.map(itemKey)} />
      ) : null}
      {selection && !desktop && !selecting ? <LongPressHint /> : null}
      <ul role={role} aria-label={label} className={cn(GRID_CLASS, className)}>
        {items.map((item) => {
          const id = itemKey(item);
          return (
            <li
              key={id}
              className={cn(
                'relative',
                selection && !desktop && 'select-none [-webkit-touch-callout:none]',
                itemClassName?.(item),
              )}
              {...bind(id)}
            >
              {renderItem(item)}
              {selection && (desktop || selecting) ? (
                <div className="absolute top-1.5 left-1.5 rounded bg-background/80 p-1">
                  <Checkbox
                    aria-label={`Pilih ${selectLabel?.(item) ?? id}`}
                    checked={selection.selected.has(id)}
                    onCheckedChange={() => selection.toggle(id)}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {hasMore ? (
        <div ref={sentinelRef} className="flex min-h-8 items-center justify-center">
          {loadingMore ? <Spinner /> : null}
          {loadMoreError ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-destructive-text">Gagal memuat halaman berikutnya</span>
              <Button type="button" variant="outline" size="sm" onClick={onLoadMore}>
                Coba lagi
              </Button>
            </div>
          ) : null}
          {!supported && !loadingMore && !loadMoreError ? (
            <Button type="button" variant="outline" size="sm" onClick={onLoadMore}>
              Muat lebih banyak
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
