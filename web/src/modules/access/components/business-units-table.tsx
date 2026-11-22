import type { BusinessUnitDto } from '@shared/contract';
import type { ReactNode } from 'react';
import { type DataColumn, DataTable, LinkCell, type RowAction } from '@/components/data-table';
import type { RowSelection } from '@/components/data-table/use-row-selection';
import { DeletedBadge } from '@/components/soft-delete/deleted-badge';
import { ActiveStatusBadge } from '@/components/status-badge';
import { formatStamp } from '@/lib/format-stamp';

export interface BusinessUnitsTableProps {
  businessUnits: readonly BusinessUnitDto[];
  /** Tampilan "Terhapus": satu-satunya aksi baris dan massal adalah Pulihkan. */
  deletedView?: boolean;
  canManage: boolean;
  /** Ada = kolom checkbox (hanya bagi pemegang `access: manage`). */
  selection?: RowSelection;
  pendingId?: string | null;
  onEdit: (businessUnit: BusinessUnitDto) => void;
  onToggleStatus: (businessUnit: BusinessUnitDto) => void;
  onDelete: (businessUnit: BusinessUnitDto) => void;
  onRestore: (businessUnit: BusinessUnitDto) => void;
  filtered?: boolean;
  onClearFilters?: () => void;
  emptyAction?: ReactNode;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
}

/**
 * Tabel Business Unit (kit CRUD): [checkbox][Aksi][Kode -> View][Nama][Status][Item][User]. Di ponsel menjadi kartu:
 * kode = judul, status = badge, sisanya meta.
 */
export function BusinessUnitsTable({
  businessUnits,
  deletedView = false,
  canManage,
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
}: BusinessUnitsTableProps) {
  const columns: DataColumn<BusinessUnitDto>[] = [
    {
      id: 'code',
      header: 'Kode',
      mobile: 'title',
      cell: (bu) => (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <LinkCell to="/access/business-units/$businessUnitId" params={{ businessUnitId: bu.id }}>
            {bu.code}
          </LinkCell>
          {bu.deleted ? <DeletedBadge /> : null}
        </span>
      ),
    },
    { id: 'name', header: 'Nama', cell: (bu) => bu.name },
    ...(deletedView
      ? ([
          {
            id: 'deletedBy',
            header: 'Dihapus oleh',
            cell: (bu) => bu.deletedInfo?.deletedBy ?? '—',
          },
          {
            id: 'deletedAt',
            header: 'Dihapus pada',
            cell: (bu) => (bu.deletedInfo ? formatStamp(bu.deletedInfo.deletedAt) : '—'),
          },
        ] satisfies DataColumn<BusinessUnitDto>[])
      : ([
          {
            id: 'status',
            header: 'Status',
            cell: (bu) => <ActiveStatusBadge status={bu.status} />,
          },
          {
            id: 'items',
            header: 'Item',
            align: 'right',
            className: 'tabular-nums',
            cell: (bu) => bu.itemCount,
          },
          {
            id: 'users',
            header: 'User',
            align: 'right',
            className: 'tabular-nums',
            cell: (bu) => bu.userCount,
          },
        ] satisfies DataColumn<BusinessUnitDto>[])),
  ];

  const actions = (bu: BusinessUnitDto): RowAction[] => {
    const busy = pendingId === bu.id;
    if (bu.deleted || deletedView) {
      return [
        {
          id: 'restore',
          action: 'restore',
          label: `Pulihkan ${bu.name}`,
          shortLabel: 'Pulihkan',
          hidden: !canManage,
          busy,
          onSelect: () => onRestore(bu),
        },
      ];
    }
    return [
      {
        id: 'edit',
        action: 'edit',
        label: `Ubah ${bu.name}`,
        shortLabel: 'Ubah',
        hidden: !canManage,
        onSelect: () => onEdit(bu),
      },
      {
        id: 'status',
        action: bu.status === 'active' ? 'deactivate' : 'activate',
        label: `${bu.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'} ${bu.name}`,
        shortLabel: bu.status === 'active' ? 'Nonaktifkan' : 'Aktifkan',
        hidden: !canManage,
        busy,
        onSelect: () => onToggleStatus(bu),
      },
      {
        id: 'delete',
        action: 'delete',
        label: `Hapus ${bu.name}`,
        shortLabel: 'Hapus',
        hidden: !canManage || bu.status !== 'inactive',
        busy,
        onSelect: () => onDelete(bu),
      },
    ];
  };

  return (
    <DataTable
      rows={businessUnits}
      rowKey={(bu) => bu.id}
      columns={columns}
      label="Daftar Business Unit"
      rowTo={(bu) => ({
        to: '/access/business-units/$businessUnitId',
        params: { businessUnitId: bu.id },
      })}
      selectLabel={(bu) => bu.name}
      selection={selection}
      actions={canManage ? actions : undefined}
      empty="Belum ada Business Unit."
      filtered={filtered}
      onClearFilters={onClearFilters}
      emptyAction={emptyAction}
      isLoading={isLoading}
      isError={isError}
      onRetry={onRetry}
    />
  );
}
