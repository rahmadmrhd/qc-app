import type { WarehouseItemOptionDto, WarehouseSerialDto } from '@shared/contract';
import { type MutableRefObject, useEffect, useMemo, useRef, useState } from 'react';
import { type DataColumn, DataTable } from '@/components/data-table';
import type { RowSelection } from '@/components/data-table/use-row-selection';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/use-mobile';
import { CUSTODY_LABEL, formatDay, STATUS_LABEL } from '@/modules/serial/lib/labels';
import { rowKey } from '../lib/draft';
import type { WarehouseDraftRow } from '../lib/draft-store';
import { isEligible } from '../lib/scan';
import {
  type RowWarning,
  referenceTestDate,
  rowTestDate,
  rowWarnings,
  snapshotWarnings,
  WARNING_LABEL,
} from '../lib/warnings';

/** Baris draf yang ditampilkan sekaligus; sisanya lewat "Tampilkan lebih banyak" (draf bisa ribuan baris). */
export const DRAFT_PAGE = 200;

interface TableRow {
  key: string;
  serial: string;
  itemLabel: string;
  buCode: string;
  locationName: string;
  testDate: string;
  statusLabel: string;
  selected: boolean;
  selectable: boolean;
  isNew: boolean;
  recorded: boolean;
  needsProof: boolean;
  warnings: RowWarning[];
  /** "SO-1, 12 Nov 2026" dari pengeluaran sebelumnya (untuk peringatan "Pernah keluar"). */
  priorDetail: string;
  reason: string | null;
  dto: WarehouseSerialDto | null;
}

export interface DispatchTableProps {
  draftRows: readonly WarehouseDraftRow[];
  candidates: readonly WarehouseSerialDto[];
  item: WarehouseItemOptionDto | null;
  /** BU form (chip BU atau BU SO) untuk warning BU. */
  formBuId: string;
  buCodeOf: (id: string) => string;
  locationNameOf: (id: string) => string;
  /** Kiriman beku: pilihan tidak dapat diubah. */
  frozen: boolean;
  /** Kunci baris yang disorot sebentar (hasil scan terakhir). */
  highlighted?: ReadonlySet<string>;
  /** SN yang dilewati server pada kiriman terakhir -> alasan (barisnya masih di draf). */
  skippedReasons?: ReadonlyMap<string, string>;
  onAdd: (serials: readonly WarehouseSerialDto[]) => void;
  onRemove: (keys: readonly string[]) => void;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  empty: string;
  filtered: boolean;
  /** Ponsel: bar bawah halaman memakai ini untuk kotak centang pilih semua / lepas semua. */
  onAllSelectedChange?: (allSelected: boolean) => void;
  /** Diisi tabel dengan aksi "pilih semua" terkini (ref, bukan state: tak memicu render ulang halaman). */
  selectAllRef?: MutableRefObject<(() => void) | null>;
}

function ineligibleReason(dto: WarehouseSerialDto): string {
  const parts: string[] = [];
  if (dto.status !== 'good') parts.push(STATUS_LABEL[dto.status]);
  if (dto.custody !== 'qc') parts.push(`posisi ${CUSTODY_LABEL[dto.custody]}`);
  return `Tidak bisa dipilih: ${parts.join(', ')}`;
}

function priorDetailOf(dto: WarehouseSerialDto | null, formBuId: string): string {
  if (!dto || dto.dispatches.length === 0) return '';
  const ref =
    dto.dispatches.find((dispatch) => dispatch.buId !== undefined && dispatch.buId === formBuId) ??
    dto.dispatches[0];
  if (!ref) return '';
  // Rujukan BU tak terbaca tanpa nomor SO: cukup kode BU dan tanggal.
  return `${ref.orderNumber ?? `BU ${ref.buCode}`}, ${formatDay(ref.dispatchedOn)}`;
}

function RowBadges({ row }: { row: TableRow }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-sm">{row.statusLabel}</span>
      {row.isNew ? (
        <Badge color="success" variant="soft">
          Draf baru
        </Badge>
      ) : null}
      {row.recorded ? (
        <Badge color="info" variant="soft">
          Tercatat WH
        </Badge>
      ) : null}
      {row.needsProof ? (
        <Badge color="warning" variant="soft">
          Butuh foto
        </Badge>
      ) : null}
      {row.warnings.map((warning) => (
        <Badge
          key={warning}
          color={warning === 'prior_other_bu' ? 'info' : 'warning'}
          variant="outline"
        >
          {WARNING_LABEL[warning]}
          {(warning === 'prior_same_bu' || warning === 'prior_other_bu') && row.priorDetail
            ? ` (${row.priorDetail})`
            : ''}
        </Badge>
      ))}
      {row.reason ? (
        <Badge color="destructive" variant="soft">
          {row.reason}
        </Badge>
      ) : null}
    </div>
  );
}

/**
 * Tabel pilihan Keluar Gudang: baris draf (selalu di atas, urutan scan; di ponsel yang terbaru di atas) lalu serial dari
 * server yang belum dipilih. Kotak centang = masuk/keluar draf. Pangkas pilihan bawaan kit TIDAK boleh menghapus draf:
 * adaptor `remove`-nya sengaja kosong (draf bukan turunan dari baris yang dimuat).
 */
export function DispatchTable({
  draftRows,
  candidates,
  item,
  formBuId,
  buCodeOf,
  locationNameOf,
  frozen,
  highlighted,
  skippedReasons,
  onAdd,
  onRemove,
  isLoading,
  isError,
  onRetry,
  hasMore,
  loadingMore,
  onLoadMore,
  empty,
  filtered,
  onAllSelectedChange,
  selectAllRef,
}: DispatchTableProps) {
  const phone = useIsMobile();
  const [visible, setVisible] = useState(DRAFT_PAGE);
  // Mode pilih kartu ponsel dipegang di sini, bukan diturunkan dari isi draf: draf selalu "terpilih", jadi mode pilih
  // otomatis akan menyala terus dan menjebak tombol kembali. Keluar dari mode = hanya menutup mode, draf tetap utuh.
  const [selectMode, setSelectMode] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<readonly string[] | null>(null);
  useEffect(() => {
    if (!phone) setSelectMode(false);
  }, [phone]);
  const selectedKeys = useMemo(() => new Set(draftRows.map(rowKey)), [draftRows]);
  const reference = useMemo(() => referenceTestDate(draftRows.map(rowTestDate)), [draftRows]);

  const tableRows = useMemo<TableRow[]>(() => {
    const context = { formBuId, referenceTestDate: reference };
    // Yang terbaru selalu terlihat: ambil ujung akhir draf (ponsel: terbaru di atas, desktop: terbaru di bawah draf).
    const shown = draftRows.slice(-visible);
    const draft = (phone ? [...shown].reverse() : shown).map((row): TableRow => {
      if (row.kind === 'new') {
        return {
          key: rowKey(row),
          serial: row.serial,
          itemLabel: item?.label ?? '',
          buCode: buCodeOf(formBuId || row.buId),
          locationName: locationNameOf(row.locationId),
          testDate: row.testDate,
          statusLabel: 'Baru',
          selected: true,
          selectable: true,
          isNew: true,
          recorded: false,
          needsProof: item?.proofRequired === true,
          warnings: rowWarnings(row, context),
          priorDetail: '',
          reason: skippedReasons?.get(row.serial) ?? null,
          dto: null,
        };
      }
      const snapshot = row.snapshot;
      return {
        key: row.id,
        serial: row.serial,
        itemLabel: snapshot.itemLabel,
        buCode: snapshot.buCode,
        locationName: snapshot.locationName,
        testDate: snapshot.testDate,
        statusLabel: STATUS_LABEL[snapshot.status],
        selected: true,
        selectable: true,
        isNew: false,
        recorded: snapshot.recorded,
        needsProof: snapshot.needsProof,
        warnings: rowWarnings(row, context),
        priorDetail: priorDetailOf(snapshot, formBuId),
        reason: skippedReasons?.get(row.serial) ?? null,
        dto: snapshot,
      };
    });
    const fromServer = candidates
      .filter((dto) => !selectedKeys.has(dto.id))
      .map((dto): TableRow => {
        const eligible = isEligible(dto);
        return {
          key: dto.id,
          serial: dto.serial,
          itemLabel: dto.itemLabel,
          buCode: dto.buCode,
          locationName: dto.locationName,
          testDate: dto.testDate,
          statusLabel: STATUS_LABEL[dto.status],
          selected: false,
          selectable: eligible,
          isNew: false,
          recorded: dto.recorded,
          needsProof: dto.needsProof,
          warnings: eligible ? snapshotWarnings(dto, context) : [],
          priorDetail: priorDetailOf(dto, formBuId),
          reason: eligible ? null : ineligibleReason(dto),
          dto,
        };
      });
    return [...draft, ...fromServer];
  }, [
    draftRows,
    candidates,
    item,
    formBuId,
    reference,
    visible,
    phone,
    selectedKeys,
    skippedReasons,
    buCodeOf,
    locationNameOf,
  ]);

  const byKey = useMemo(() => new Map(tableRows.map((row) => [row.key, row])), [tableRows]);

  const selection = useMemo<RowSelection>(() => {
    const addByKeys = (keys: readonly string[]) => {
      const dtos = keys.flatMap((key) => {
        const row = byKey.get(key);
        // Serial milik Item lain tak boleh masuk (mis. data lama yang masih tampil saat Item baru diganti).
        return row &&
          !row.selected &&
          row.selectable &&
          row.dto &&
          (!item || row.dto.itemId === item.id)
          ? [row.dto]
          : [];
      });
      if (dtos.length > 0) onAdd(dtos);
    };
    return {
      selected: selectedKeys,
      count: selectedKeys.size,
      modeCount: selectMode ? 1 : 0,
      toggle: (key) => {
        if (phone && !selectMode) {
          // Tekan lama / "Pilih" pada baris yang sudah di draf hanya MASUK mode pilih; tidak mengeluarkannya.
          setSelectMode(true);
          if (selectedKeys.has(key)) return;
        }
        if (selectedKeys.has(key)) onRemove([key]);
        else addByKeys([key]);
      },
      setAll: (keys, on) => {
        if (on) {
          addByKeys(keys);
          return;
        }
        const drop = keys.filter((key) => selectedKeys.has(key));
        if (drop.length === 0) return;
        // Menghapus serial draf baru tak dapat dibatalkan: minta konfirmasi (spek 5.3).
        if (drop.some((key) => key.startsWith('new:'))) setPendingRemove(drop);
        else onRemove(drop);
      },
      // Pemangkasan kit (id yang tak ada di baris dimuat) diabaikan: draf tidak boleh hilang diam-diam.
      remove: () => undefined,
      // Keluar dari mode pilih (tombol X, kembali): hanya menutup mode, TIDAK menghapus draf.
      clear: () => setSelectMode(false),
    };
  }, [byKey, selectedKeys, onAdd, onRemove, phone, selectMode, item]);

  // Kotak centang bar bawah ponsel: semua baris yang boleh dipilih sudah terpilih = centang; selain itu mengklik memilih
  // semuanya (setAll hanya menambah yang belum terpilih dan memuat Item yang sama).
  const selectableKeys = useMemo(
    () => tableRows.filter((row) => row.selectable).map((row) => row.key),
    [tableRows],
  );
  const allSelected =
    selectableKeys.length > 0 && selectableKeys.every((key) => selectedKeys.has(key));
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  if (selectAllRef) selectAllRef.current = () => selectionRef.current.setAll(selectableKeys, true);
  useEffect(() => {
    onAllSelectedChange?.(allSelected);
  }, [allSelected, onAllSelectedChange]);

  const columns: DataColumn<TableRow>[] = [
    {
      id: 'serial',
      header: 'Serial Number',
      cell: (row) => <span className="font-mono text-sm">{row.serial}</span>,
      mobile: 'title',
    },
    { id: 'item', header: 'Item', cell: (row) => row.itemLabel },
    { id: 'bu', header: 'BU', cell: (row) => row.buCode },
    { id: 'location', header: 'Lokasi', cell: (row) => row.locationName },
    {
      id: 'testDate',
      header: 'Tanggal uji',
      cell: (row) => (row.testDate === '' ? '—' : formatDay(row.testDate)),
    },
    { id: 'status', header: 'Status', cell: (row) => <RowBadges row={row} /> },
  ];

  return (
    <div className="space-y-2">
      <DataTable
        rows={tableRows}
        rowKey={(row) => row.key}
        columns={columns}
        label="Serial Number untuk Keluar Gudang"
        selection={selection}
        selectLabel={(row) => row.serial}
        rowSelectable={(row) => !frozen && row.selectable}
        isLoading={isLoading}
        isError={isError}
        onRetry={onRetry}
        hasMore={hasMore}
        loadingMore={loadingMore}
        onLoadMore={onLoadMore}
        filtered={filtered}
        empty={empty}
        fit="content"
        rowHighlighted={(row) => highlighted?.has(row.key) ?? false}
      />
      {draftRows.length > visible ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            color="primary"
            onClick={() => setVisible((current) => current + DRAFT_PAGE)}
          >
            Tampilkan lebih banyak ({draftRows.length - visible} lebih lama)
          </Button>
        </div>
      ) : null}
      <AlertDialog
        open={pendingRemove !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRemove(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Keluarkan dari pilihan?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingRemove?.length ?? 0} serial akan dikeluarkan dari pilihan. Serial draf baru
              yang dikeluarkan terbuang dan harus di-scan ulang.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Kembali</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingRemove) onRemove(pendingRemove);
                setPendingRemove(null);
              }}
            >
              Keluarkan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <p className="hidden text-xs text-muted-foreground wide:block">
        Tips: Shift+klik pada kotak centang memilih satu rentang sekaligus.
      </p>
    </div>
  );
}
