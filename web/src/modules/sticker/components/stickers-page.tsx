import type { ListStatusFilter } from '@shared/batch';
import type {
  BusinessUnitOptionDto,
  StickerDto,
  StickerStockDto,
  StickerTypeDto,
} from '@shared/contract';
import { normalizeKey } from '@shared/items';
import { formatStockQty, type StickerStatus } from '@shared/stickers';
import { ChevronDown } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { toast } from 'sonner';
import { ActionButton } from '@/components/action-button';
import {
  BulkBar,
  type DataColumn,
  DataTable,
  LinkCell,
  type RowAction,
  useBulkAction,
  useRowSelection,
} from '@/components/data-table';
import { LinkMultiField } from '@/components/link-field';
import { FilterBar, FilterChip, multiFilterDisplay } from '@/components/page/filter-bar';
import { ListPage } from '@/components/page/list-page';
import { Select } from '@/components/select';
import { ConfirmDeleteDialog } from '@/components/soft-delete/confirm-delete-dialog';
import { DeletedBadge } from '@/components/soft-delete/deleted-badge';
import { ActiveStatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { describeError } from '@/lib/api/describe-error';
import { FILTER_LIST_MAX } from '@/lib/filter-limits';
import { formatStamp } from '@/lib/format-stamp';
import { useUrlSyncedText } from '@/modules/access/lib/use-url-synced-text';
import { STICKER_STATUS_LABEL } from '../lib/status';
import {
  StickerFormDialog,
  type StickerFormDialogProps,
  type StickerSaveInput,
  type StickerSaveResult,
} from './sticker-form-dialog';
import { type StickerStockPanel, stockAvailability, useStockActions } from './stock-actions';
import type { StockEntryMode } from './stock-entry-dialog';

export type { StickerStockPanel, StockPageLocation } from './stock-actions';

/** Status pada filter halaman: status daftar bersama (`all|active|inactive|deleted`) ditambah `deprecated` (Usang). */
export type StickerStatusFilter = ListStatusFilter | 'deprecated';

/** Filter halaman Stiker (search params Router). `typeIds` kosong = semua jenis. */
export interface StickersFilter {
  q: string;
  /** Id jenis (mode katalog; boleh lebih dari satu); pada mode stok saja (tanpa daftar jenis) berisi NAMA jenis. */
  typeIds: string[];
  status: StickerStatusFilter;
}

/** Aksi tulis katalog yang dikirim bertahap; masing-masing mengembalikan hasil server per id. */
export interface StickerMutations {
  setStatus: (ids: string[], status: 'active' | 'inactive') => Promise<readonly unknown[]>;
  remove: (ids: string[]) => Promise<readonly unknown[]>;
  restore: (ids: string[]) => Promise<readonly unknown[]>;
  /** Muat ulang daftar (dipanggil bila ada tahap massal yang gagal). */
  reload: () => void;
}

export interface StickersPageProps {
  /**
   * Katalog (butuh `sticker: view`). Tanpa ini (user hanya berizin stok) halaman dibangun dari baris stok saja:
   * kolom BU/minimum, aksi katalog, checkbox, dan tautan nama tidak tampil.
   */
  stickers?: readonly StickerDto[] | undefined;
  types: readonly StickerTypeDto[];
  businessUnits: readonly BusinessUnitOptionDto[];
  /** Stok per lokasi (butuh `stickerstock: view` di lokasi terpilih); kosong = kolom dan aksi stok tak tampil. */
  stock?: StickerStockPanel | undefined;
  canEdit: boolean;
  canManage: boolean;
  /** Kode BU menaut ke halaman BU hanya bila pengguna berhak (`businessUnitLinkAccess`). */
  canOpenBusinessUnit?: boolean;
  filter: StickersFilter;
  onFilterChange: (patch: Partial<StickersFilter>) => void;
  pendingStatusId: string | null;
  /** Mengembalikan galat (tampil di dialog) atau `null` bila berhasil. */
  onSave: (input: StickerSaveInput) => Promise<StickerSaveResult>;
  /** Diteruskan ke form stiker: tambah jenis/BU dan tautan buka BU, hanya bila user berhak (lihat `lib/link-access`). */
  onCreateType?: StickerFormDialogProps['onCreateType'];
  onCreateBusinessUnit?: StickerFormDialogProps['onCreateBusinessUnit'];
  openBusinessUnitHref?: StickerFormDialogProps['openBusinessUnitHref'];
  openStickerTypeHref?: StickerFormDialogProps['openStickerTypeHref'];
  onToggleStatus: (sticker: StickerDto) => void;
  mutations: StickerMutations;
  /** Membuka halaman stok opname. */
  onStartOpname: () => void;
  /**
   * Membuka halaman "Entri stok" batch pada mode itu; `stickerIds` (dari aksi stok massal di bar pilihan) mengisi
   * entri awal dengan stiker-stiker itu.
   */
  onStartEntry: (mode: StockEntryMode, stickerIds?: string[]) => void;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
}

/** Nama yang tampil untuk tim QC: alias bila ada, selain itu nama stiker. */
function displayName(sticker: Pick<StickerDto, 'name' | 'alias'>): string {
  return sticker.alias === '' ? sticker.name : sticker.alias;
}

/** Satu baris tabel: gabungan katalog dan stok stiker yang sama (salah satunya bisa tidak ada). */
interface Row {
  id: string;
  label: string;
  /** Nama asli bila `label` adalah alias. */
  fullName: string | null;
  typeName: string;
  status: StickerStatus;
  low: boolean;
  catalog: StickerDto | undefined;
  stock: StickerStockDto | undefined;
}

function buildRows(
  stickers: readonly StickerDto[] | undefined,
  stock: readonly StickerStockDto[] | undefined,
): Row[] {
  const stockById = new Map((stock ?? []).map((row) => [row.stickerId, row]));
  if (stickers) {
    return stickers.map((sticker) => ({
      id: sticker.id,
      label: displayName(sticker),
      fullName: sticker.alias === '' ? null : sticker.name,
      typeName: sticker.typeName,
      status: sticker.status,
      low: sticker.low,
      catalog: sticker,
      stock: stockById.get(sticker.id),
    }));
  }
  return (stock ?? []).map((row) => ({
    id: row.stickerId,
    label: row.name,
    fullName: null,
    typeName: row.typeName,
    status: row.status,
    low: row.low,
    catalog: undefined,
    stock: row,
  }));
}

/**
 * Halaman Stiker (kit CRUD): katalog dan stok dalam SATU tabel. Kolom Stok, Per lokasi, dan menu "Stok" hanya untuk
 * pemegang izin stok; checkbox, aksi katalog, dan tautan nama hanya untuk pembaca katalog. Filter (cari, jenis,
 * status) ada di search params lewat `filter`/`onFilterChange`; tampilan Terhapus (hanya `sticker: manage`) tanpa
 * kolom dan menu stok.
 */
export function StickersPage({
  stickers,
  types,
  businessUnits,
  stock: stockProp,
  canEdit,
  canManage,
  canOpenBusinessUnit = true,
  filter,
  onFilterChange,
  pendingStatusId,
  onSave,
  onCreateType,
  onCreateBusinessUnit,
  openBusinessUnitHref,
  openStickerTypeHref,
  onToggleStatus,
  mutations,
  onStartOpname,
  onStartEntry,
  isLoading,
  isError,
  onRetry,
}: StickersPageProps) {
  const deletedView = filter.status === 'deleted';
  // Tampilan Terhapus tanpa stok: stiker terhapus tak muncul di baris stok.
  const stock = deletedView ? undefined : stockProp;
  const catalogMode = stickers !== undefined;
  /** `'new'` = dialog tambah; objek = dialog ubah stiker itu. */
  const [dialog, setDialog] = useState<StickerDto | 'new' | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<
    { kind: 'bulk' } | { kind: 'row'; id: string }
  >();
  const [text, setText] = useUrlSyncedText(filter.q, (value) => onFilterChange({ q: value }));
  const stockActions = useStockActions(stock);
  const selection = useRowSelection(JSON.stringify(filter));

  const buById = new Map(businessUnits.map((bu) => [bu.id, bu]));
  const typeById = new Map(types.map((type) => [type.id, type]));
  const codeById = new Map(
    (stock?.locations ?? []).map((location) => [location.id, location.code]),
  );
  const showBreakdown = (stock?.locations.length ?? 0) > 1;
  const rows = buildRows(stickers, stock?.rows);
  const termKey = normalizeKey(text);
  const typeNames = catalogMode
    ? types.map((type) => ({ id: type.id, label: type.name }))
    : [...new Set(rows.map((row) => row.typeName))]
        .sort((a, b) => a.localeCompare(b))
        .map((name) => ({ id: name, label: name }));
  const typeLabelOf = (id: string) => typeNames.find((option) => option.id === id)?.label ?? id;

  const visible = rows.filter((row) => {
    if (filter.typeIds.length > 0) {
      const matches = filter.typeIds.includes(row.catalog ? row.catalog.typeId : row.typeName);
      if (!matches) return false;
    }
    if (filter.status !== 'all' && filter.status !== 'deleted' && row.status !== filter.status) {
      return false;
    }
    if (termKey === '') return true;
    return [row.label, row.fullName ?? '', row.catalog?.name ?? ''].some((value) =>
      normalizeKey(value).includes(termKey),
    );
  });
  const visibleCatalog = visible.flatMap((row) => (row.catalog ? [row.catalog] : []));

  const reload = mutations.reload;
  // Pilihan massal: katalog (`sticker: manage`) dan/atau aksi stok (`stickerstock`) pada baris yang punya stok.
  const canStockBulk = Boolean(stock) && (stock?.canEdit === true || stock?.canManage === true);
  const bulkSelection = (canManage || canStockBulk) && catalogMode ? selection : undefined;
  const systemKindOf = (sticker: StickerDto) => typeById.get(sticker.typeId)?.systemKind ?? '';
  const stickerOf = (id: string) => visibleCatalog.find((entry) => entry.id === id);
  // Syarat per aksi massal (keputusan pemilik 2026-11-23): tombol tampil bila minimal satu baris terpilih memenuhinya
  // dan hanya baris itu yang dikirim. Aturan sama dengan aksi per baris di bawah.
  // Aktifkan: Usang tak dapat diaktifkan; Manual Book nonaktif hanya bila versi TERBARU konfigurasinya.
  const canActivate = (id: string) => {
    const sticker = stickerOf(id);
    return (
      sticker !== undefined &&
      sticker.status === 'inactive' &&
      (systemKindOf(sticker) !== 'manual_book' || sticker.latestManualBookVersion)
    );
  };
  const canDeactivate = (id: string) => {
    const sticker = stickerOf(id);
    return sticker !== undefined && sticker.status !== 'inactive';
  };
  // Hapus: hanya yang bukan Aktif dan bukan jenis sistem. Pulihkan: stiker jenis sistem dipulihkan lewat induknya.
  const canRemove = (id: string) => {
    const sticker = stickerOf(id);
    return sticker !== undefined && sticker.status !== 'active' && systemKindOf(sticker) === '';
  };
  const canRestore = (id: string) => {
    const sticker = stickerOf(id);
    return sticker !== undefined && systemKindOf(sticker) === '';
  };
  const changedIds = (ids: string[], changes: (sticker: StickerDto) => boolean) =>
    ids.filter((id) => {
      const sticker = visibleCatalog.find((entry) => entry.id === id);
      return sticker === undefined || changes(sticker);
    });
  const activate = useBulkAction({
    selection,
    subject: 'stiker',
    verb: 'diaktifkan',
    eligible: canActivate,
    send: (ids) => mutations.setStatus(ids, 'active'),
    undo: {
      changed: (ids) => changedIds(ids, (sticker) => sticker.status !== 'active'),
      run: (ids) => mutations.setStatus(ids, 'inactive'),
    },
    reload,
  });
  const deactivate = useBulkAction({
    selection,
    subject: 'stiker',
    verb: 'dinonaktifkan',
    eligible: canDeactivate,
    send: (ids) => mutations.setStatus(ids, 'inactive'),
    undo: {
      changed: (ids) => changedIds(ids, (sticker) => sticker.status === 'active'),
      run: (ids) => mutations.setStatus(ids, 'active'),
    },
    reload,
  });
  const remove = useBulkAction({
    selection,
    subject: 'stiker',
    verb: 'dihapus',
    eligible: canRemove,
    send: (ids) => mutations.remove(ids),
    undo: { label: 'Pulihkan', run: (ids) => mutations.restore(ids) },
    reload,
  });
  const restore = useBulkAction({
    selection,
    subject: 'stiker',
    verb: 'dipulihkan',
    eligible: canRestore,
    send: (ids) => mutations.restore(ids),
    reload,
  });
  const bulkBusy = activate.busy || deactivate.busy || remove.busy || restore.busy;
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  // Aksi stok massal: stiker terpilih yang boleh dicatat pada mode itu (aturan sama dengan menu Stok per baris).
  const stockTargets = (mode: StockEntryMode): string[] => {
    if (!stock) return [];
    return [...selection.selected].filter((id) => {
      const stockRow = rows.find((row) => row.id === id)?.stock;
      if (!stockRow) return false;
      const { canIn, canOut, canAdjust } = stockAvailability(stock, stockRow);
      return mode === 'in' ? canIn : mode === 'out' ? canOut : canAdjust;
    });
  };

  async function restoreRow(sticker: StickerDto) {
    setRowBusy(sticker.id);
    try {
      await mutations.restore([sticker.id]);
      toast.success('Stiker dipulihkan (Nonaktif)');
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setRowBusy(null);
    }
  }

  async function confirmDelete() {
    const target = deleteTarget;
    if (!target) return;
    if (target.kind === 'bulk') {
      await remove.run();
      setDeleteTarget(undefined);
      return;
    }
    setRowBusy(target.id);
    try {
      await mutations.remove([target.id]);
      toast.success('Stiker dihapus');
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setRowBusy(null);
      setDeleteTarget(undefined);
    }
  }

  const columns: DataColumn<Row>[] = [
    {
      id: 'name',
      header: 'Stiker',
      mobile: 'title',
      cell: (row) => {
        const { catalog, stock: stockRow } = row;
        return (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {catalog ? (
                <LinkCell to="/sticker/$stickerId" params={{ stickerId: catalog.id }}>
                  {row.label}
                </LinkCell>
              ) : (
                <span className="font-medium">{row.label}</span>
              )}
              {catalog?.deleted ? <DeletedBadge /> : null}
              {row.low && !catalog?.deleted ? (
                <Badge color="warning" variant="soft">
                  Menipis
                </Badge>
              ) : null}
              {stockRow?.typeStatus === 'inactive' ? (
                <Badge color="secondary" variant="soft">
                  Jenis nonaktif
                </Badge>
              ) : null}
            </div>
            {row.fullName !== null ? (
              <div className="text-xs text-muted-foreground">{row.fullName}</div>
            ) : null}
          </>
        );
      },
    },
    {
      id: 'type',
      header: 'Jenis',
      cell: (row) => {
        const { catalog } = row;
        return catalog ? (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            {catalog.typeDeleted && !canManage ? (
              // Jenis terhapus hanya dapat dibuka pemulih (`sticker: manage`); selain itu nama + penanda tanpa tautan.
              <span>{row.typeName}</span>
            ) : (
              <LinkCell to="/sticker/types/$typeId" params={{ typeId: catalog.typeId }}>
                {row.typeName}
              </LinkCell>
            )}
            {catalog.typeDeleted ? <DeletedBadge /> : null}
          </span>
        ) : (
          row.typeName
        );
      },
    },
    ...(catalogMode
      ? ([
          {
            id: 'bu',
            header: 'BU',
            cell: (row) =>
              !row.catalog || row.catalog.businessUnitIds.length === 0 ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {row.catalog.businessUnitIds.map((buId) => {
                    const bu = buById.get(buId);
                    if (!bu) return null;
                    return canOpenBusinessUnit ? (
                      <LinkCell
                        key={buId}
                        to="/access/business-units/$businessUnitId"
                        params={{ businessUnitId: buId }}
                        title={bu.name}
                      >
                        {bu.code}
                      </LinkCell>
                    ) : (
                      <Badge key={buId} variant="outline" color="primary" title={bu.name}>
                        {bu.code}
                      </Badge>
                    );
                  })}
                </div>
              ),
          },
        ] satisfies DataColumn<Row>[])
      : []),
    ...(stock
      ? ([
          {
            id: 'stock',
            header: 'Stok',
            align: 'right',
            className: 'tabular-nums',
            cell: (row) => (
              <span
                className={row.stock && row.stock.total < 0 ? 'text-destructive-text' : undefined}
              >
                {row.stock ? formatStockQty(row.stock.total) : '0'}
              </span>
            ),
          },
        ] satisfies DataColumn<Row>[])
      : []),
    ...(showBreakdown
      ? ([
          {
            id: 'breakdown',
            header: 'Per lokasi',
            cell: (row) => (
              <div className="flex flex-wrap gap-1">
                {(row.stock?.byLocation ?? []).map((item) => (
                  <Badge key={item.locationId} variant="outline" color="primary">
                    {`${codeById.get(item.locationId) ?? item.locationId} ${formatStockQty(item.qty)}`}
                  </Badge>
                ))}
              </div>
            ),
          },
        ] satisfies DataColumn<Row>[])
      : []),
    ...(catalogMode
      ? ([
          {
            id: 'min',
            header: 'Batas minimum',
            align: 'right',
            className: 'tabular-nums',
            cell: (row) => row.catalog?.minQty,
          },
        ] satisfies DataColumn<Row>[])
      : []),
    // Tampilan Terhapus: "Dihapus oleh" dan "Dihapus pada" menggantikan Status (selalu Nonaktif).
    ...(deletedView
      ? ([
          {
            id: 'deletedBy',
            header: 'Dihapus oleh',
            cell: (row) => row.catalog?.deleted?.deletedBy ?? '—',
          },
          {
            id: 'deletedAt',
            header: 'Dihapus pada',
            cell: (row) =>
              row.catalog?.deleted ? formatStamp(row.catalog.deleted.deletedAt) : '—',
          },
        ] satisfies DataColumn<Row>[])
      : ([
          {
            id: 'status',
            header: 'Status',
            cell: (row) => (
              <ActiveStatusBadge status={row.status} label={STICKER_STATUS_LABEL[row.status]} />
            ),
          },
        ] satisfies DataColumn<Row>[])),
  ];

  // Aksi stok (B10): satu entri "Stok" bersubmenu di kolom Aksi (desktop: satu dropdown; ponsel: grup datar "Stok" di
  // menu ⋯, tanpa submenu bersarang). Hanya bila baris punya stok yang boleh dilihat pengguna.
  const stockEntry = (row: Row): RowAction | null => {
    if (!stock || !row.stock) return null;
    const stockRow = row.stock;
    const { canIn, canOut, canAdjust } = stockAvailability(stock, stockRow);
    return {
      id: 'stock',
      action: 'stock',
      label: `Stok ${row.label}`,
      shortLabel: 'Stok',
      onSelect: () => undefined,
      submenu: [
        {
          id: 'stock-in',
          action: 'stockIn',
          label: 'Catat masuk',
          hidden: !canIn,
          onSelect: () => stockActions.openEntry('in', stockRow.stickerId),
        },
        {
          id: 'stock-out',
          action: 'stockOut',
          label: 'Catat keluar',
          hidden: !canOut,
          onSelect: () => stockActions.openEntry('out', stockRow.stickerId),
        },
        {
          id: 'stock-adjust',
          action: 'adjust',
          label: 'Koreksi',
          hidden: !canAdjust,
          onSelect: () => stockActions.openEntry('adjust', stockRow.stickerId),
        },
        {
          id: 'stock-history',
          action: 'history',
          label: 'Riwayat',
          onSelect: () => stockActions.openHistory(stockRow),
        },
      ],
    };
  };

  const actions = (row: Row): RowAction[] => {
    const { catalog } = row;
    const stockAction = stockEntry(row);
    // Pemegang stok tanpa katalog tetap mendapat kolom Aksi berisi entri Stok.
    if (!catalog) return stockAction ? [stockAction] : [];
    const busy = pendingStatusId === catalog.id || rowBusy === catalog.id;
    const systemKind = typeById.get(catalog.typeId)?.systemKind ?? '';
    if (catalog.deleted || deletedView) {
      return [
        {
          id: 'restore',
          action: 'restore',
          label: `Pulihkan ${row.label}`,
          shortLabel: 'Pulihkan',
          // Stiker jenis sistem dipulihkan lewat induknya (Desain QR/Postel): server selalu menolaknya di sini.
          hidden: !canManage || systemKind !== '',
          busy,
          onSelect: () => void restoreRow(catalog),
        },
      ];
    }
    // Usang hanya dapat menjadi nonaktif (server menolak mengaktifkannya); stiker Manual Book yang nonaktif hanya dapat
    // diaktifkan kembali bila versi TERBARU konfigurasinya (spek 4a §3 butir 15, keputusan pemilik 2026-11-11); stiker
    // Postel tidak dibatasi (spek 4b §3 butir 5).
    const canToggle =
      catalog.status !== 'inactive' ||
      systemKind !== 'manual_book' ||
      catalog.latestManualBookVersion;
    return [
      {
        id: 'edit',
        action: 'edit',
        label: `Ubah ${row.label}`,
        shortLabel: 'Ubah',
        hidden: !canEdit,
        onSelect: () => setDialog(catalog),
      },
      ...(stockAction ? [stockAction] : []),
      {
        id: 'status',
        action: catalog.status === 'inactive' ? 'activate' : 'deactivate',
        label: `${catalog.status === 'inactive' ? 'Aktifkan' : 'Nonaktifkan'} ${row.label}`,
        shortLabel: catalog.status === 'inactive' ? 'Aktifkan' : 'Nonaktifkan',
        hidden: !canManage || !canToggle,
        busy,
        onSelect: () => onToggleStatus(catalog),
      },
      {
        id: 'delete',
        action: 'delete',
        label: `Hapus ${row.label}`,
        shortLabel: 'Hapus',
        // Hanya stiker bukan Aktif yang dapat dihapus, dan bukan stiker jenis sistem (mengikuti konfigurasinya).
        hidden: !canManage || catalog.status === 'active' || systemKind !== '',
        busy,
        onSelect: () => setDeleteTarget({ kind: 'row', id: catalog.id }),
      },
    ];
  };

  const statusOptions = [
    { value: 'all', label: 'Semua status' },
    { value: 'active', label: 'Aktif' },
    { value: 'inactive', label: 'Nonaktif' },
    { value: 'deprecated', label: 'Usang' },
    ...(canManage && catalogMode ? [{ value: 'deleted', label: 'Terhapus' }] : []),
  ];
  const statusLabel = statusOptions.find((option) => option.value === filter.status)?.label;
  const filtered = termKey !== '' || filter.typeIds.length > 0 || filter.status !== 'all';
  const countLabel =
    !isLoading && !isError && (visible.length > 0 || filtered)
      ? `${visible.length} stiker`
      : undefined;
  const canEntry = (stock?.canEdit ?? false) || (stock?.canManage ?? false);

  const headerActions: ReactNode =
    stock && (stock.canManage || canEntry) ? (
      <>
        {canEntry ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" color="primary">
                Entri stok
                <ChevronDown aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {stock.canEdit ? (
                <DropdownMenuItem onSelect={() => onStartEntry('in')}>Catat masuk</DropdownMenuItem>
              ) : null}
              {stock.canEdit ? (
                <DropdownMenuItem onSelect={() => onStartEntry('out')}>
                  Catat keluar
                </DropdownMenuItem>
              ) : null}
              {stock.canManage ? (
                <DropdownMenuItem onSelect={() => onStartEntry('adjust')}>Koreksi</DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {stock.canManage ? (
          <Button type="button" variant="outline" color="primary" onClick={onStartOpname}>
            Stok opname
          </Button>
        ) : null}
      </>
    ) : null;

  return (
    <>
      <ListPage
        title="Stiker"
        count={countLabel}
        actions={headerActions}
        createAction={
          catalogMode && canEdit && !deletedView
            ? { label: 'Tambah stiker', onClick: () => setDialog('new') }
            : undefined
        }
        filters={
          <FilterBar
            search={{
              value: text,
              onChange: setText,
              placeholder: 'Cari nama atau alias stiker',
              label: 'Cari stiker',
            }}
          >
            <FilterChip
              label="Jenis"
              display={multiFilterDisplay(filter.typeIds.map(typeLabelOf))}
              onClear={() => onFilterChange({ typeIds: [] })}
            >
              <LinkMultiField
                maxSelected={FILTER_LIST_MAX}
                id="sticker-filter-type"
                label="Filter jenis"
                hideLabel
                placeholder="Semua jenis"
                options={typeNames}
                localFilter
                highlight
                value={filter.typeIds}
                labelOf={typeLabelOf}
                onChange={(next) => onFilterChange({ typeIds: next })}
              />
            </FilterChip>
            <FilterChip
              label="Status"
              display={filter.status === 'all' ? null : statusLabel}
              onClear={() => onFilterChange({ status: 'all' })}
            >
              <Select
                id="sticker-filter-status"
                label="Filter status"
                hideLabel
                options={statusOptions}
                value={filter.status}
                onValueChange={(next) => onFilterChange({ status: next as StickerStatusFilter })}
              />
            </FilterChip>
          </FilterBar>
        }
        bulkBar={
          bulkSelection ? (
            <BulkBar count={selection.count} onClear={selection.clear} busy={bulkBusy}>
              {deletedView ? (
                canManage && restore.eligibleCount > 0 ? (
                  <ActionButton action="restore" onClick={() => void restore.run()} />
                ) : null
              ) : (
                <>
                  {(['in', 'out', 'adjust'] as const).map((mode) =>
                    stockTargets(mode).length > 0 ? (
                      <ActionButton
                        key={mode}
                        action={mode === 'in' ? 'stockIn' : mode === 'out' ? 'stockOut' : 'adjust'}
                        onClick={() => onStartEntry(mode, stockTargets(mode))}
                      />
                    ) : null,
                  )}
                  {canManage && activate.eligibleCount > 0 ? (
                    <ActionButton action="activate" onClick={() => void activate.run()} />
                  ) : null}
                  {canManage && deactivate.eligibleCount > 0 ? (
                    <ActionButton action="deactivate" onClick={() => void deactivate.run()} />
                  ) : null}
                  {canManage && remove.eligibleCount > 0 ? (
                    <ActionButton
                      action="delete"
                      onClick={() => setDeleteTarget({ kind: 'bulk' })}
                    />
                  ) : null}
                </>
              )}
            </BulkBar>
          ) : null
        }
      >
        <p className="mb-3 text-sm text-muted-foreground">
          {catalogMode
            ? 'Katalog stiker beserta stok, BU, dan batas minimum.'
            : 'Stok stiker di lokasi yang dipilih.'}
          {stock ? ' "Menipis" dihitung dari total semua lokasi.' : ''}
        </p>
        <DataTable
          rows={visible}
          rowKey={(row) => row.id}
          columns={columns}
          label="Daftar stiker"
          rowTo={(row) =>
            row.catalog
              ? { to: '/sticker/$stickerId', params: { stickerId: row.catalog.id } }
              : null
          }
          selectLabel={(row) => row.label}
          selection={bulkSelection}
          actions={catalogMode || stock ? actions : undefined}
          empty="Belum ada stiker."
          filtered={filtered}
          onClearFilters={() => {
            setText('');
            onFilterChange({ q: '', typeIds: [], status: 'all' });
          }}
          emptyAction={
            catalogMode && canEdit && !deletedView ? (
              <Button type="button" onClick={() => setDialog('new')}>
                Tambah stiker
              </Button>
            ) : undefined
          }
          isLoading={isLoading}
          isError={isError}
          onRetry={onRetry}
        />
      </ListPage>
      <StickerFormDialog
        open={dialog !== null}
        onOpenChange={(open) => (open ? undefined : setDialog(null))}
        sticker={dialog === null || dialog === 'new' ? undefined : dialog}
        types={types}
        businessUnits={businessUnits}
        onSave={onSave}
        onCreateType={onCreateType}
        onCreateBusinessUnit={onCreateBusinessUnit}
        openBusinessUnitHref={openBusinessUnitHref}
        openStickerTypeHref={openStickerTypeHref}
      />
      <ConfirmDeleteDialog
        open={deleteTarget !== undefined}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(undefined);
        }}
        count={deleteTarget?.kind === 'bulk' ? remove.eligibleCount : 1}
        subject="stiker"
        onConfirm={() => void confirmDelete()}
        busy={remove.busy || rowBusy !== null}
      />
      {stockActions.dialogs}
    </>
  );
}
