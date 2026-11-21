import type { ItemSummaryDto } from '@shared/contract';
import type { ReactNode } from 'react';
import { type DataColumn, DataTable, LinkCell, type RowAction } from '@/components/data-table';
import type { RowSelection } from '@/components/data-table/use-row-selection';
import { DeletedBadge } from '@/components/soft-delete/deleted-badge';
import { ActiveStatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { formatStamp } from '@/lib/format-stamp';
import { NoManualBookNote } from './manual-book-note';
import { NoPostelNote } from './no-postel-note';
import { NoInstructionsNote } from './sticker-instructions-view';

export interface ItemsTableProps {
  items: readonly ItemSummaryDto[];
  /** Tampilan "Terhapus": satu-satunya aksi baris dan massal adalah Pulihkan. */
  deletedView?: boolean;
  /** Per item: BU item menentukan hak (keputusan 13), jadi tak cukup satu tanda global. */
  canEdit: (item: ItemSummaryDto) => boolean;
  canManage: (item: ItemSummaryDto) => boolean;
  /** Nama merk menaut ke View merk hanya bila pengguna berhak (`brandLinkAccess`). */
  canOpenBrand?: boolean;
  /** Merk terhapus hanya menaut ke View bagi pemegang izin Pulihkan (`item: manage`); selain itu teks + penanda. */
  canOpenDeletedBrand?: boolean;
  /** Kode BU menaut ke halaman BU hanya bila pengguna berhak (`businessUnitLinkAccess`). */
  canOpenBusinessUnit?: boolean;
  /** Ada = kolom checkbox (hanya bagi pemegang `item: manage`). */
  selection?: RowSelection;
  pendingId?: string | null;
  onEdit: (item: ItemSummaryDto) => void;
  onToggleStatus: (item: ItemSummaryDto) => void;
  onDelete: (item: ItemSummaryDto) => void;
  onRestore: (item: ItemSummaryDto) => void;
  /** Ada filter/pencarian aktif: kosong berarti "tidak cocok" dan menawarkan hapus filter. */
  filtered?: boolean;
  onClearFilters?: () => void;
  /** Ajakan pada daftar kosong tanpa filter (mis. tombol Tambah item). */
  emptyAction?: ReactNode;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  loadMoreError?: boolean;
  onLoadMore?: () => void;
}

const itemLabel = (item: ItemSummaryDto) => `${item.brand} ${item.model}`;

export function ItemsTable({
  items,
  deletedView = false,
  canEdit,
  canManage,
  canOpenBrand = true,
  canOpenDeletedBrand = true,
  canOpenBusinessUnit = true,
  selection,
  pendingId = null,
  onEdit,
  onToggleStatus,
  onDelete,
  onRestore,
  filtered,
  onClearFilters,
  emptyAction,
  isLoading,
  isError,
  onRetry,
  hasMore,
  loadingMore,
  loadMoreError,
  onLoadMore,
}: ItemsTableProps) {
  const columns: DataColumn<ItemSummaryDto>[] = [
    {
      id: 'brand',
      header: 'Merk',
      cell: (item) => (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          {canOpenBrand && (!item.brandDeleted || canOpenDeletedBrand) ? (
            <LinkCell to="/item/brands/$brandId" params={{ brandId: item.brandId }}>
              {item.brand}
            </LinkCell>
          ) : (
            <span className="font-medium">{item.brand}</span>
          )}
          {item.brandDeleted ? <DeletedBadge /> : null}
        </span>
      ),
    },
    {
      id: 'model',
      header: 'Tipe',
      cell: (item) => (
        <>
          <LinkCell to="/item/$itemId" params={{ itemId: item.id }}>
            {item.model}
          </LinkCell>
          {item.deleted ? (
            <span className="ml-1.5 align-middle">
              <DeletedBadge />
            </span>
          ) : null}
          {item.hasInstructions ? null : <NoInstructionsNote className="block" />}
          {/* Hanya item aktif: item nonaktif tak lagi memerlukan label Manual Book. */}
          {item.status === 'active' && !item.hasManualBook ? (
            <NoManualBookNote className="block" />
          ) : null}
          {item.status === 'active' && !item.hasPostel ? <NoPostelNote className="block" /> : null}
          {item.aliases.length > 0 ? (
            <div className="text-xs text-muted-foreground">
              <span className="sr-only">Nama lain: </span>
              {item.aliases.join(', ')}
            </div>
          ) : null}
        </>
      ),
    },
    {
      id: 'bu',
      header: 'BU',
      cell: (item) => (
        <div className="flex flex-wrap gap-1">
          {item.businessUnits.map((bu) =>
            canOpenBusinessUnit ? (
              <LinkCell
                key={bu.id}
                to="/access/business-units/$businessUnitId"
                params={{ businessUnitId: bu.id }}
                title={bu.name}
              >
                {bu.code}
              </LinkCell>
            ) : (
              <Badge key={bu.id} variant="outline" color="primary" title={bu.name}>
                {bu.code}
              </Badge>
            ),
          )}
        </div>
      ),
    },
    // Tampilan Terhapus (soft delete 4.5): "Dihapus oleh" dan "Dihapus pada" menggantikan Lock, Gambar, dan
    // Status (selalu Nonaktif) agar jumlah kolom tetap.
    ...(deletedView
      ? ([
          {
            id: 'deletedBy',
            header: 'Dihapus oleh',
            cell: (item) => item.deleted?.deletedBy ?? '—',
          },
          {
            id: 'deletedAt',
            header: 'Dihapus pada',
            cell: (item) => (item.deleted ? formatStamp(item.deleted.deletedAt) : '—'),
          },
        ] satisfies DataColumn<ItemSummaryDto>[])
      : ([
          {
            id: 'lock',
            header: 'Lock',
            cell: (item) =>
              item.isCountryLock ? (
                <Badge color="secondary" variant="outline">
                  Country lock
                </Badge>
              ) : null,
          },
          {
            id: 'images',
            header: 'Gambar',
            align: 'right',
            className: 'tabular-nums',
            cell: (item) => item.imageCount,
          },
          {
            id: 'status',
            header: 'Status',
            cell: (item) => <ActiveStatusBadge status={item.status} />,
          },
        ] satisfies DataColumn<ItemSummaryDto>[])),
  ];

  const actions = (item: ItemSummaryDto): RowAction[] => {
    const label = itemLabel(item);
    const busy = pendingId === item.id;
    if (item.deleted || deletedView) {
      return [
        {
          id: 'restore',
          action: 'restore',
          label: `Pulihkan ${label}`,
          hidden: !canManage(item),
          busy,
          onSelect: () => onRestore(item),
        },
      ];
    }
    return [
      {
        id: 'edit',
        action: 'edit',
        label: `Ubah ${label}`,
        hidden: !canEdit(item),
        onSelect: () => onEdit(item),
      },
      {
        id: 'status',
        action: item.status === 'active' ? 'deactivate' : 'activate',
        label: `${item.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'} ${label}`,
        hidden: !canManage(item),
        busy,
        onSelect: () => onToggleStatus(item),
      },
      {
        id: 'delete',
        action: 'delete',
        label: `Hapus ${label}`,
        // Hanya item Nonaktif yang dapat dihapus (server: "Nonaktifkan item dulu sebelum dihapus").
        hidden: !canManage(item) || item.status !== 'inactive',
        busy,
        onSelect: () => onDelete(item),
      },
    ];
  };

  return (
    <DataTable
      rows={items}
      rowKey={(item) => item.id}
      columns={columns}
      label="Daftar item"
      selectLabel={itemLabel}
      selection={selection}
      actions={actions}
      empty="Belum ada item."
      filtered={filtered}
      onClearFilters={onClearFilters}
      emptyAction={emptyAction}
      isLoading={isLoading}
      isError={isError}
      onRetry={onRetry}
      hasMore={hasMore}
      loadingMore={loadingMore}
      loadMoreError={loadMoreError}
      onLoadMore={onLoadMore}
    />
  );
}
