import { formatBuLabel } from '@shared/business-units';
import type { ReadyStockBoxDto, WarehouseSerialDto } from '@shared/contract';
import {
  readyStockClipboard,
  WAREHOUSE_BOX_LIMITS,
  WAREHOUSE_LIMITS,
} from '@shared/serial-warehouse';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ActionButton } from '@/components/action-button';
import {
  BulkBar,
  type RowSelection,
  usePruneSelection,
  useRowSelection,
} from '@/components/data-table';
import { LinkMultiField, type LinkOption } from '@/components/link-field';
import { FilterBar, FilterChip, multiFilterDisplay } from '@/components/page/filter-bar';
import { ListPage } from '@/components/page/list-page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { api } from '@/lib/api';
import { FILTER_LIST_MAX } from '@/lib/filter-limits';
import { useUrlSyncedText } from '@/modules/access/lib/use-url-synced-text';
import { buIdsWithLevelOf, canUseWarehouse } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { copyLines } from '../lib/clipboard';
import { HAND_OFF_ROWS_MAX, type HandOffRow, handOffToDispatch } from '../lib/hand-off';
import { capRows, readyProblemLabel } from '../lib/ready-box';
import { type ReadySearchParams, toReadyStockInput } from '../lib/ready-stock-filter';
import { lookupWarehouseSerials, readyStockQueryOptions } from '../queries';
import { type ReadyRow, ReadyStockTable } from './ready-stock-table';

export interface ReadyStockPageProps {
  search: ReadySearchParams;
  onSearchChange: (patch: Partial<ReadySearchParams>) => void;
}

const LOOKUP_CHUNK = WAREHOUSE_LIMITS.lookupMax;

/** Meratakan kardus menjadi baris serial; nada selang-seling per kardus menurut urutan tampil. */
function flatten(boxes: readonly ReadyStockBoxDto[], startTone: 'a' | 'b'): ReadyRow[] {
  const rows: ReadyRow[] = [];
  let tone = startTone;
  for (const box of boxes) {
    box.serials.forEach((serial, index) => {
      rows.push({
        id: serial.id,
        serial: serial.serial,
        boxId: box.id,
        boxNumber: box.number,
        capacity: box.capacity,
        remaining: box.remaining,
        recordedOn: serial.recordedOn,
        processing: serial.processing,
        problem: readyProblemLabel(serial.status, serial.custody),
        tone,
        firstOfBox: index === 0,
        itemLabel: box.itemLabel,
        buLabel: formatBuLabel({ code: box.buCode, name: box.buName }),
      });
    });
    tone = tone === 'a' ? 'b' : 'a';
  }
  return rows;
}

/** Pilihan bagian tabel: hanya id yang ada di bagian itu; perubahan diteruskan ke pilihan bersama. */
function sectionSelection(master: RowSelection, rows: readonly ReadyRow[]): RowSelection {
  const ids = new Set(rows.map((row) => row.id));
  const selected = new Set([...master.selected].filter((id) => ids.has(id)));
  return {
    selected,
    count: selected.size,
    toggle: master.toggle,
    setAll: master.setAll,
    remove: master.remove,
    clear: master.clear,
  };
}

function chunksOf<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    out.push(items.slice(start, start + size));
  }
  return out;
}

/**
 * Stok Ready per kardus (kit CRUD): ringkasan, dua bagian tabel (Kardus penuh lalu Ecer), pilihan per serial dan per
 * kardus, "Pilih N unit sesuai urutan", salin ke clipboard, dan oper ke form Catat Serial WH (Penjualan).
 */
export function ReadyStockPage({ search, onSearchChange }: ReadyStockPageProps) {
  const me = useMe();
  const stack = useStackNavigation();
  const canEdit = canUseWarehouse(me);
  const filter = toReadyStockInput(search);
  const filterKey = JSON.stringify(filter);
  const filtered = Object.keys(filter).length > 0;
  const list = useInfiniteQuery(readyStockQueryOptions(filter));
  const boxes = useMemo<ReadyStockBoxDto[]>(
    () => list.data?.pages.flatMap((page) => page.boxes) ?? [],
    [list.data],
  );
  const totals = list.data?.pages[0]?.totals;

  const fullRows = useMemo(
    () =>
      flatten(
        boxes.filter((box) => box.kind === 'full'),
        'a',
      ),
    [boxes],
  );
  const looseRows = useMemo(() => {
    const fullBoxCount = boxes.filter((box) => box.kind === 'full').length;
    return flatten(
      boxes.filter((box) => box.kind === 'loose'),
      fullBoxCount % 2 === 0 ? 'a' : 'b',
    );
  }, [boxes]);
  const allRows = useMemo(() => [...fullRows, ...looseRows], [fullRows, looseRows]);

  const master = useRowSelection(filterKey);
  usePruneSelection(
    master,
    allRows.filter((row) => !row.processing && row.problem === '').map((row) => row.id),
    !list.isPending,
  );
  const fullSelection = sectionSelection(master, fullRows);
  const looseSelection = sectionSelection(master, looseRows);
  const toggleBox = useCallback(
    (boxId: string, on: boolean) => {
      master.setAll(
        allRows
          .filter((row) => row.boxId === boxId && !row.processing && row.problem === '')
          .map((row) => row.id),
        on,
      );
    },
    [allRows, master],
  );
  const selectedRows = allRows.filter((row) => master.selected.has(row.id));

  const [pickText, setPickText] = useState('');
  const [pickError, setPickError] = useState('');
  const [picking, setPicking] = useState(false);
  const [copyingAll, setCopyingAll] = useState(false);
  const [handingOff, setHandingOff] = useState(false);

  async function pickInOrder() {
    const count = Number(pickText);
    if (!Number.isInteger(count) || count < 1) {
      setPickError('Isi jumlah unit lebih dari 0');
      return;
    }
    if (count > WAREHOUSE_BOX_LIMITS.pickMax) {
      setPickError(`Paling banyak ${WAREHOUSE_BOX_LIMITS.pickMax} unit sekali pilih`);
      return;
    }
    setPickError('');
    setPicking(true);
    try {
      const output = await api('serialWarehouse.readyStock', {
        ...filter,
        pickCount: count,
        limit: 1,
      });
      const picked = output.picked ?? [];
      // Serial pilihan yang belum termuat (halaman berikutnya) dimuat dulu agar dapat disalin dan dioper.
      let loaded = new Set(allRows.map((row) => row.id));
      let hasNext = list.hasNextPage;
      while (hasNext && !picked.every((id) => loaded.has(id))) {
        const next = await list.fetchNextPage();
        loaded = new Set(
          (next.data?.pages ?? []).flatMap((page) =>
            page.boxes.flatMap((box) => box.serials.map((serial) => serial.id)),
          ),
        );
        hasNext = next.hasNextPage;
      }
      master.clear();
      master.setAll(picked, true);
      if (picked.length < count) toast.message(`Hanya ${picked.length} unit yang bisa dipilih.`);
    } catch (error) {
      setPickError(error instanceof Error ? error.message : 'Gagal memilih unit. Coba lagi.');
    } finally {
      setPicking(false);
    }
  }

  async function copySelected() {
    const text = readyStockClipboard(
      selectedRows.map((row) => ({ box: row.boxNumber, serial: row.serial })),
    );
    const ok = await copyLines(text);
    if (ok) toast.success(`${selectedRows.length} serial disalin.`);
    else toast.error('Tidak dapat menyalin ke clipboard.');
  }

  /** Tanpa pilihan: salin SEMUA serial terfilter (memuat halaman yang belum termuat, maks. `HAND_OFF_ROWS_MAX`). */
  async function copyAll() {
    setCopyingAll(true);
    try {
      let pages = list.data?.pages ?? [];
      let hasNext = list.hasNextPage;
      const count = () =>
        pages.reduce(
          (sum, page) => sum + page.boxes.reduce((n, box) => n + box.serials.length, 0),
          0,
        );
      while (hasNext && count() < HAND_OFF_ROWS_MAX) {
        const next = await list.fetchNextPage();
        pages = next.data?.pages ?? pages;
        hasNext = next.hasNextPage;
      }
      const loadedBoxes = pages.flatMap((page) => page.boxes);
      const fullPart = flatten(
        loadedBoxes.filter((box) => box.kind === 'full'),
        'a',
      );
      const loosePart = flatten(
        loadedBoxes.filter((box) => box.kind === 'loose'),
        'a',
      );
      const available = [...fullPart, ...loosePart].filter((row) => !row.processing);
      const { rows, truncated } = capRows(available, HAND_OFF_ROWS_MAX);
      if (rows.length === 0) {
        toast.message('Tidak ada serial untuk disalin.');
        return;
      }
      const ok = await copyLines(
        readyStockClipboard(rows.map((row) => ({ box: row.boxNumber, serial: row.serial }))),
      );
      if (!ok) toast.error('Tidak dapat menyalin ke clipboard.');
      else if (truncated || hasNext) {
        toast.warning(
          `Hanya ${rows.length} serial pertama yang disalin (batas ${HAND_OFF_ROWS_MAX}).`,
        );
      } else toast.success(`${rows.length} serial disalin.`);
    } catch {
      toast.error('Gagal memuat semua serial. Coba lagi.');
    } finally {
      setCopyingAll(false);
    }
  }

  async function handOff() {
    const ids = selectedRows.map((row) => row.id);
    if (ids.length === 0) return;
    setHandingOff(true);
    try {
      const found: WarehouseSerialDto[] = [];
      for (const chunk of chunksOf(ids, LOOKUP_CHUNK)) {
        const output = await lookupWarehouseSerials({ ids: chunk });
        found.push(...output.found);
      }
      const byId = new Map(found.map((serial) => [serial.id, serial]));
      const rows: HandOffRow[] = ids.flatMap((id) => {
        const serial = byId.get(id);
        return serial
          ? [
              {
                serialId: serial.id,
                serial: serial.serial,
                itemId: serial.itemId,
                buId: serial.buId,
                snapshot: serial,
              },
            ]
          : [];
      });
      if (rows.length === 0) {
        toast.error('Serial yang dipilih tidak ditemukan lagi.');
        return;
      }
      if (rows.length < ids.length) {
        toast.warning(`${ids.length - rows.length} serial tidak ditemukan dan dilewati.`);
      }
      handOffToDispatch(rows, me.email);
      stack.push({ to: '/serial/gudang' });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Tidak dapat meneruskan ke form pengeluaran.',
      );
    } finally {
      setHandingOff(false);
    }
  }

  const tableProps = {
    onToggleBox: toggleBox,
    isLoading: list.isPending,
    isError: list.isLoadingError,
    onRetry: () => void list.refetch(),
    filtered,
    onClearFilters: () =>
      onSearchChange({ query: undefined, buIds: undefined, itemIds: undefined }),
  };
  const isEmpty = !list.isPending && !list.isLoadingError && boxes.length === 0;
  const boxCount = (rows: readonly ReadyRow[]) => new Set(rows.map((row) => row.boxId)).size;

  return (
    <ListPage
      title="Stok Ready"
      filters={
        <ReadyStockFilters
          search={search}
          onChange={onSearchChange}
          itemFacets={list.data?.pages[0]?.itemFacets ?? []}
        />
      }
      bulkBar={
        <BulkBar count={master.count} onClear={master.clear} busy={handingOff}>
          {canEdit ? (
            <ActionButton
              action="warehouse"
              label="Keluarkan ke Penjualan"
              onClick={() => void handOff()}
            />
          ) : null}
          <ActionButton
            action="copy"
            label="Salin ke clipboard"
            onClick={() => void copySelected()}
          />
        </BulkBar>
      }
    >
      <div className="space-y-4">
        {totals ? (
          <p className="text-sm text-muted-foreground" role="status">
            {totals.units} unit · {totals.fullBoxes} kardus penuh · {totals.looseBoxes} ecer
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>Pilih</span>
          <Input
            aria-label="Jumlah unit"
            type="number"
            inputMode="numeric"
            min={1}
            className="w-24"
            value={pickText}
            onChange={(event) => {
              setPickText(event.target.value);
              setPickError('');
            }}
          />
          <span>unit sesuai urutan</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            color="primary"
            aria-label="Pilih sesuai urutan"
            disabled={picking || pickText.trim() === ''}
            onClick={() => void pickInOrder()}
          >
            Pilih
          </Button>
          {master.count === 0 ? (
            <ActionButton
              action="copy"
              label="Salin ke clipboard"
              disabled={copyingAll || boxes.length === 0}
              onClick={() => void copyAll()}
            />
          ) : null}
        </div>
        {pickError ? (
          <p role="alert" className="text-xs text-destructive-text">
            {pickError}
          </p>
        ) : null}

        {isEmpty || list.isPending || list.isLoadingError ? (
          <ReadyStockTable
            label="Stok Ready"
            rows={[]}
            selection={master}
            empty="Belum ada stok ready."
            {...tableProps}
          />
        ) : (
          <>
            <section className="space-y-2">
              <div className="flex items-baseline gap-2">
                <h2 className="text-base font-semibold">Kardus penuh</h2>
                <span className="text-xs text-muted-foreground">{boxCount(fullRows)} kardus</span>
              </div>
              <ReadyStockTable
                label="Kardus penuh"
                rows={fullRows}
                selection={fullSelection}
                empty="Tidak ada kardus penuh."
                {...tableProps}
              />
            </section>
            <section className="space-y-2">
              <div className="flex items-baseline gap-2">
                <h2 className="text-base font-semibold">Ecer</h2>
                <span className="text-xs text-muted-foreground">{boxCount(looseRows)} kardus</span>
              </div>
              <ReadyStockTable
                label="Kardus ecer"
                rows={looseRows}
                selection={looseSelection}
                empty="Tidak ada kardus ecer."
                hasMore={list.hasNextPage}
                loadingMore={list.isFetchingNextPage}
                loadMoreError={list.isFetchNextPageError}
                onLoadMore={() => void list.fetchNextPage()}
                {...tableProps}
              />
            </section>
          </>
        )}
      </div>
    </ListPage>
  );
}

function ReadyStockFilters({
  search,
  onChange,
  itemFacets,
}: {
  search: ReadySearchParams;
  onChange: (patch: Partial<ReadySearchParams>) => void;
  itemFacets: readonly { id: string; label: string }[];
}) {
  const me = useMe();
  // Pilihan Tipe dari facet stok (terbaca bagi pemegang view); tidak butuh rute pilihan Item.
  const itemMap = new Map(itemFacets.map((facet) => [facet.id, facet.label]));
  const itemOptions: LinkOption[] = itemFacets.map((facet) => ({
    id: facet.id,
    label: facet.label,
  }));
  const itemLabel = (id: string) => itemMap.get(id) ?? 'Tipe terpilih';
  const itemIds = search.itemIds ?? [];
  const readableBu = new Set(buIdsWithLevelOf(me, 'serialwh', 'view'));
  const buOptions: LinkOption[] = (me.businessUnits ?? [])
    .filter((bu) => !bu.deleted && readableBu.has(bu.id))
    .map((bu) => ({ id: bu.id, label: formatBuLabel(bu) }));
  const buLabel = (id: string) =>
    buOptions.find((option) => option.id === id)?.label ?? 'BU tidak dikenal';
  const buIds = search.buIds ?? [];
  const [text, setText] = useUrlSyncedText(search.query ?? '', (value) =>
    onChange({ query: value.trim() === '' ? undefined : value.trim() }),
  );
  return (
    <FilterBar
      search={{
        value: text,
        onChange: setText,
        placeholder: 'Cari serial atau nomor kardus',
        label: 'Cari serial atau nomor kardus',
      }}
    >
      <FilterChip
        label="BU"
        display={multiFilterDisplay(buIds.map(buLabel))}
        onClear={() => onChange({ buIds: undefined })}
      >
        <LinkMultiField
          maxSelected={FILTER_LIST_MAX}
          id="wh-ready-bu"
          label="Filter BU"
          hideLabel
          placeholder="Semua BU"
          localFilter
          highlight
          value={buIds}
          labelOf={buLabel}
          options={buOptions}
          onChange={(next) => onChange({ buIds: next.length > 0 ? next : undefined })}
        />
      </FilterChip>
      <FilterChip
        label="Tipe"
        display={multiFilterDisplay(itemIds.map(itemLabel))}
        onClear={() => onChange({ itemIds: undefined })}
      >
        <LinkMultiField
          maxSelected={FILTER_LIST_MAX}
          id="wh-ready-item"
          label="Filter Tipe"
          hideLabel
          placeholder="Semua Tipe"
          highlight
          value={itemIds}
          labelOf={itemLabel}
          options={itemOptions}
          localFilter
          onChange={(next) => onChange({ itemIds: next.length > 0 ? next : undefined })}
        />
      </FilterChip>
    </FilterBar>
  );
}
