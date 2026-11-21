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
import { DisabledReason } from '@/components/disabled-reason';
import { LinkField } from '@/components/link-field';
import { FilterBar, FilterChip } from '@/components/page/filter-bar';
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
import { formatStamp } from '@/lib/format-stamp';
import { useUrlSyncedText } from '@/modules/access/lib/use-url-synced-text';
import { STICKER_STATUS_LABEL } from '../lib/status';
import {
  StickerFormDialog,
  type StickerFormDialogProps,
  type StickerSaveInput,
  type StickerSaveResult,
} from './sticker-form-dialog';
import { type StickerStockPanel, StockMenu, useStockActions } from './stock-actions';
import type { StockEntryMode } from './stock-entry-dialog';

export type { StickerStockPanel, StockPageLocation } from './stock-actions';

/** Status pada filter halaman: status daftar bersama (`all|active|inactive|deleted`) ditambah `deprecated` (Usang). */
export type StickerStatusFilter = ListStatusFilter | 'deprecated';

/** Filter halaman Stiker (search params Router). `typeId` kosong = semua jenis. */
export interface StickersFilter {
  q: string;
  /** Id jenis (mode katalog); pada mode stok saja (tanpa daftar jenis) berisi NAMA jenis. */
  typeId: string;
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
  onToggleStatus: (sticker: StickerDto) => void;
  mutations: StickerMutations;
  /** Membuka halaman stok opname. */
  onStartOpname: () => void;
  /** Membuka halaman "Entri stok" batch pada mode itu. */
  onStartEntry: (mode: StockEntryMode) => void;
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

const NOT_ACTIVE_FIRST = 'Nonaktifkan stiker dulu sebelum dihapus';
const SYSTEM_NO_DELETE =
  'Stiker Manual Book dan Postel mengikuti konfigurasinya, jadi tidak bisa dihapus di sini';

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
  const typeFilterLabel = typeNames.find((option) => option.id === filter.typeId)?.label;

  const visible = rows.filter((row) => {
    if (filter.typeId !== '') {
      const matches = row.catalog
        ? row.catalog.typeId === filter.typeId
        : row.typeName === filter.typeId;
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
  const bulkSelection = canManage && catalogMode ? selection : undefined;
  const changedIds = (ids: string[], changes: (sticker: StickerDto) => boolean) =>
    ids.filter((id) => {
      const sticker = visibleCatalog.find((entry) => entry.id === id);
      return sticker === undefined || changes(sticker);
    });
  const activate = useBulkAction({
    selection,
    subject: 'stiker',
    verb: 'diaktifkan',
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
    send: (ids) => mutations.remove(ids),
    undo: { label: 'Pulihkan', run: (ids) => mutations.restore(ids) },
    reload,
  });
  const restore = useBulkAction({
    selection,
    subject: 'stiker',
    verb: 'dipulihkan',
    send: (ids) => mutations.restore(ids),
    reload,
  });
  const bulkBusy = activate.busy || deactivate.busy || remove.busy || restore.busy;
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  const selected = visibleCatalog.filter((sticker) => selection.selected.has(sticker.id));
  const hasActive = selected.some((sticker) => sticker.status === 'active');
  const hasSystem = selected.some((sticker) => typeById.get(sticker.typeId)?.systemKind);
  const deleteBlockedReason = hasSystem
    ? SYSTEM_NO_DELETE
    : hasActive
      ? NOT_ACTIVE_FIRST
      : undefined;

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
                <Badge color="warning" variant="soft" dot>
                  Menipis
                </Badge>
              ) : null}
              {stockRow?.typeStatus === 'inactive' ? (
                <Badge color="secondary" variant="soft" dot>
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
            <LinkCell to="/sticker/types/$typeId" params={{ typeId: catalog.typeId }}>
              {row.typeName}
            </LinkCell>
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
                      <Badge key={buId} variant="outline" title={bu.name}>
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
                  <Badge key={item.locationId} variant="outline">
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
    // Menu "Stok" bukan kosakata `ActionKind`, jadi tetap satu menu terpisah (nama aksesibel `Stok <nama>`).
    ...(stock
      ? ([
          {
            id: 'stockActions',
            header: 'Aksi stok',
            cell: (row) =>
              row.stock ? (
                <StockMenu
                  row={row.stock}
                  label={row.label}
                  panel={stock}
                  controller={stockActions}
                />
              ) : null,
          },
        ] satisfies DataColumn<Row>[])
      : []),
  ];

  const actions = (row: Row): RowAction[] => {
    const { catalog } = row;
    if (!catalog) return [];
    const busy = pendingStatusId === catalog.id || rowBusy === catalog.id;
    if (catalog.deleted || deletedView) {
      return [
        {
          id: 'restore',
          action: 'restore',
          label: `Pulihkan ${row.label}`,
          hidden: !canManage,
          busy,
          onSelect: () => void restoreRow(catalog),
        },
      ];
    }
    const systemKind = typeById.get(catalog.typeId)?.systemKind ?? '';
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
        hidden: !canEdit,
        onSelect: () => setDialog(catalog),
      },
      {
        id: 'status',
        action: catalog.status === 'inactive' ? 'activate' : 'deactivate',
        label: `${catalog.status === 'inactive' ? 'Aktifkan' : 'Nonaktifkan'} ${row.label}`,
        hidden: !canManage || !canToggle,
        busy,
        onSelect: () => onToggleStatus(catalog),
      },
      {
        id: 'delete',
        action: 'delete',
        label: `Hapus ${row.label}`,
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
  const filtered = termKey !== '' || filter.typeId !== '' || filter.status !== 'all';
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
              <Button type="button" variant="outline">
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
          <Button type="button" variant="outline" onClick={onStartOpname}>
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
              display={filter.typeId === '' ? null : (typeFilterLabel ?? filter.typeId)}
              onClear={() => onFilterChange({ typeId: '' })}
            >
              <LinkField
                id="sticker-filter-type"
                label="Filter jenis"
                hideLabel
                placeholder="Semua jenis"
                options={typeNames}
                localFilter
                highlight
                value={filter.typeId === '' ? null : filter.typeId}
                labelOf={(id) => typeNames.find((option) => option.id === id)?.label}
                onChange={(next) => onFilterChange({ typeId: next ?? '' })}
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
                <ActionButton action="restore" onClick={() => void restore.run()} />
              ) : (
                <>
                  <ActionButton action="activate" onClick={() => void activate.run()} />
                  <ActionButton action="deactivate" onClick={() => void deactivate.run()} />
                  <DisabledReason reason={deleteBlockedReason}>
                    <ActionButton
                      action="delete"
                      disabled={deleteBlockedReason !== undefined}
                      onClick={() => setDeleteTarget({ kind: 'bulk' })}
                    />
                  </DisabledReason>
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
          selectLabel={(row) => row.label}
          selection={bulkSelection}
          actions={catalogMode ? actions : undefined}
          empty="Belum ada stiker."
          filtered={filtered}
          onClearFilters={() => {
            setText('');
            onFilterChange({ q: '', typeId: '', status: 'all' });
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
      />
      <ConfirmDeleteDialog
        open={deleteTarget !== undefined}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(undefined);
        }}
        count={deleteTarget?.kind === 'bulk' ? selection.count : 1}
        subject="stiker"
        onConfirm={() => void confirmDelete()}
        busy={remove.busy || rowBusy !== null}
      />
      {stockActions.dialogs}
    </>
  );
}
