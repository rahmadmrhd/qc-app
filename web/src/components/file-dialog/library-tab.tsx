import {
  type InfiniteData,
  keepPreviousData,
  useInfiniteQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { Eye, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { NativeSelect } from '@/components/native-select';
import { Spinner } from '@/components/spinner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { errorText } from './error-text';
import { FileDropZone } from './file-drop-zone';
import { InlineName } from './inline-name';
import type { FileLibrarySource, LibraryItem, LibraryPage, LibrarySort } from './types';
import { useInfiniteSentinel } from './use-infinite-sentinel';

const SORT_OPTIONS: ReadonlyArray<{ value: LibrarySort; label: string }> = [
  { value: 'newest', label: 'Terbaru' },
  { value: 'oldest', label: 'Terlama' },
  { value: 'nameAsc', label: 'Nama A-Z' },
  { value: 'nameDesc', label: 'Nama Z-A' },
  { value: 'sizeDesc', label: 'Ukuran terbesar' },
];

const SEARCH_DELAY_MS = 300;

export interface LibraryTabProps {
  source: FileLibrarySource;
  selection: ReadonlyMap<string, LibraryItem>;
  mode: 'single' | 'multiple';
  onToggle(item: LibraryItem): void;
  onPreview(item: LibraryItem): void;
  accept: readonly string[];
  onFiles(files: File[], rejected: { name: string; reason: string }[]): void;
  /** Bawaan true; false = tampilan halaman (tanpa pilihan; klik kartu membuka pratinjau). */
  selectable?: boolean;
  /** Item diganti nama / dihapus di sini: pemilik pilihan menyelaraskan salinannya. */
  onRenamed?(item: LibraryItem): void;
  onRemoved?(id: string): void;
}

type ListData = InfiniteData<LibraryPage, string | null>;

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

/** Tab Pustaka: kisi berhalaman (gulir tak terbatas), cari, urut, filter, ganti nama, dan hapus. */
export function LibraryTab({
  source,
  selection,
  mode,
  onToggle,
  onPreview,
  accept,
  onFiles,
  selectable = true,
  onRenamed,
  onRemoved,
}: LibraryTabProps) {
  const queryClient = useQueryClient();
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText, SEARCH_DELAY_MS);
  const [sort, setSort] = useState<LibrarySort>('newest');
  const [mine, setMine] = useState(false);
  const [unused, setUnused] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<LibraryItem | null>(null);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());

  const query = useMemo(() => ({ search, sort, mine, unused }), [search, sort, mine, unused]);
  const result = useInfiniteQuery({
    queryKey: [source.key, query],
    queryFn: ({ pageParam, signal }) => source.list(query, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last: LibraryPage) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  // Kursor tetap menjaga urutan, tetapi item baru/dipindah antar halaman dapat muncul dua kali: satu per id.
  const items = useMemo(() => {
    const seen = new Map<string, LibraryItem>();
    for (const page of result.data?.pages ?? []) {
      for (const item of page.items) if (!seen.has(item.id)) seen.set(item.id, item);
    }
    return [...seen.values()];
  }, [result.data]);

  const { fetchNextPage, hasNextPage, isFetchingNextPage, isFetchNextPageError } = result;
  const { ref: sentinelRef, supported } = useInfiniteSentinel({
    enabled: Boolean(hasNextPage) && !isFetchingNextPage && !isFetchNextPageError,
    onVisible: () => void fetchNextPage(),
    resetKey: items.length,
  });

  function patchCaches(update: (items: LibraryItem[]) => LibraryItem[]) {
    queryClient.setQueriesData<ListData>({ queryKey: [source.key] }, (data) =>
      data?.pages
        ? { ...data, pages: data.pages.map((page) => ({ ...page, items: update(page.items) })) }
        : data,
    );
  }

  function setBusy(id: string, busy: boolean) {
    setBusyIds((current) => {
      const next = new Set(current);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function rename(item: LibraryItem, name: string) {
    setBusy(item.id, true);
    try {
      const updated = await source.rename(item.id, name);
      // Ganti di tempat pada semua daftar tersimpan: tanpa memuat ulang seluruh daftar.
      patchCaches((list) => list.map((entry) => (entry.id === updated.id ? updated : entry)));
      onRenamed?.(updated);
    } catch (error) {
      toast.error(errorText(error, 'Gagal mengganti nama'));
    } finally {
      setBusy(item.id, false);
    }
  }

  async function remove(item: LibraryItem) {
    setBusy(item.id, true);
    try {
      await source.remove(item.id);
      patchCaches((list) => list.filter((entry) => entry.id !== item.id));
      onRemoved?.(item.id);
    } catch (error) {
      toast.error(errorText(error, 'Gagal menghapus gambar'));
    } finally {
      setBusy(item.id, false);
    }
  }

  const filtered = search !== '' || mine || unused;
  const showSkeleton = result.isPending;
  const showError = result.isError && items.length === 0 && !result.isFetching;
  const showEmpty = !showSkeleton && !result.isError && items.length === 0;

  return (
    <FileDropZone accept={accept} onFiles={onFiles} className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="Cari gambar"
            placeholder="Cari nama gambar"
            className="pl-8"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
          />
        </div>
        <NativeSelect
          aria-label="Urutkan"
          className="sm:w-44"
          value={sort}
          onChange={(event) => setSort(event.target.value as LibrarySort)}
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={mine ? 'default' : 'outline'}
          aria-pressed={mine}
          onClick={() => setMine((value) => !value)}
        >
          Diunggah oleh saya
        </Button>
        <Button
          type="button"
          size="sm"
          variant={unused ? 'default' : 'outline'}
          aria-pressed={unused}
          onClick={() => setUnused((value) => !value)}
        >
          Belum dipakai
        </Button>
      </div>

      {showSkeleton ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 10 }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: kerangka statis
            <Skeleton key={index} className="aspect-square" />
          ))}
        </div>
      ) : null}

      {showError ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center text-sm">
          <p className="text-destructive">Gagal memuat pustaka gambar</p>
          <Button type="button" variant="outline" onClick={() => void result.refetch()}>
            Coba lagi
          </Button>
        </div>
      ) : null}

      {showEmpty ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {filtered ? 'Tidak ada hasil' : 'Belum ada gambar'}
        </p>
      ) : null}

      {items.length > 0 ? (
        <ul
          role={mode === 'single' && selectable ? 'radiogroup' : undefined}
          aria-label="Pustaka gambar"
          className={cn(
            'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5',
            result.isPlaceholderData && 'opacity-60',
          )}
        >
          {items.map((item) => {
            const selected = selection.has(item.id);
            const busy = busyIds.has(item.id);
            const inUse = item.usageCount > 0;
            return (
              <li
                key={item.id}
                className={cn(
                  'flex flex-col overflow-hidden rounded-lg border bg-card',
                  selected && 'ring-2 ring-primary',
                )}
              >
                <div className="relative aspect-square bg-muted">
                  <button
                    type="button"
                    className="absolute inset-0 flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    tabIndex={selectable ? -1 : undefined}
                    aria-label={selectable ? undefined : `Pratinjau ${item.name}`}
                    onClick={() => (selectable ? onToggle(item) : onPreview(item))}
                  >
                    <img
                      src={item.thumbUrl}
                      alt={item.name}
                      loading="lazy"
                      width={item.width}
                      height={item.height}
                      className="size-full object-contain"
                    />
                  </button>
                  {selectable ? (
                    <div className="absolute top-1.5 left-1.5 rounded bg-background/80 p-1">
                      {mode === 'single' ? (
                        <input
                          type="radio"
                          name={`pilihan-${source.key}`}
                          checked={selected}
                          aria-label={`Pilih ${item.name}`}
                          className="size-4 accent-primary"
                          onChange={() => undefined}
                          onClick={() => onToggle(item)}
                        />
                      ) : (
                        <Checkbox
                          checked={selected}
                          aria-label={`Pilih ${item.name}`}
                          onCheckedChange={() => onToggle(item)}
                        />
                      )}
                    </div>
                  ) : null}
                  {selectable ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon-sm"
                      className="absolute top-1.5 right-1.5"
                      aria-label={`Pratinjau ${item.name}`}
                      onClick={() => onPreview(item)}
                    >
                      <Eye />
                    </Button>
                  ) : null}
                </div>
                <div className="flex items-center gap-1 p-2 text-sm">
                  <InlineName
                    value={item.name}
                    maxLength={source.nameMax}
                    readOnly={!item.canRename || busy}
                    className="flex-1"
                    onSave={(name) => void rename(item, name)}
                  />
                  {item.canRemove ? (
                    <span title={inUse ? 'Masih dipakai' : undefined} className="shrink-0">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={inUse || busy}
                        aria-label={
                          inUse ? `Hapus ${item.name} (masih dipakai)` : `Hapus ${item.name}`
                        }
                        onClick={() => setPendingDelete(item)}
                      >
                        {busy ? <Spinner /> : <Trash2 />}
                      </Button>
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {items.length > 0 && hasNextPage ? (
        <div ref={sentinelRef} className="flex min-h-8 items-center justify-center">
          {isFetchingNextPage ? <Spinner /> : null}
          {isFetchNextPageError ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-destructive">Gagal memuat halaman berikutnya</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void fetchNextPage()}
              >
                Coba lagi
              </Button>
            </div>
          ) : null}
          {!supported && !isFetchingNextPage && !isFetchNextPageError ? (
            <Button type="button" variant="outline" size="sm" onClick={() => void fetchNextPage()}>
              Muat lebih banyak
            </Button>
          ) : null}
        </div>
      ) : null}

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus gambar?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? `"${pendingDelete.name}" akan dihapus permanen dari pustaka dan tidak dapat dikembalikan.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const target = pendingDelete;
                setPendingDelete(null);
                if (target) void remove(target);
              }}
            >
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </FileDropZone>
  );
}
