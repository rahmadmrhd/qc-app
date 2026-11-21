import type { LocationDto } from '@shared/contract';
import type { ReactNode } from 'react';
import { type DataColumn, DataTable, LinkCell, type RowAction } from '@/components/data-table';
import type { RowSelection } from '@/components/data-table/use-row-selection';
import { DeletedBadge } from '@/components/soft-delete/deleted-badge';
import { ActiveStatusBadge } from '@/components/status-badge';
import { formatStamp } from '@/lib/format-stamp';

export interface LocationsTableProps {
  locations: readonly LocationDto[];
  /** Tampilan "Terhapus": satu-satunya aksi baris dan massal adalah Pulihkan. */
  deletedView?: boolean;
  canManage: boolean;
  /** Ada = kolom checkbox (hanya bagi pemegang `access: manage`). */
  selection?: RowSelection;
  pendingId?: string | null;
  onEdit: (location: LocationDto) => void;
  onToggleStatus: (location: LocationDto) => void;
  onDelete: (location: LocationDto) => void;
  onRestore: (location: LocationDto) => void;
  filtered?: boolean;
  onClearFilters?: () => void;
  emptyAction?: ReactNode;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
}

/**
 * Tabel lokasi (kit CRUD): [checkbox][Aksi][Kode -> View][Nama][Status]. Di ponsel menjadi kartu: kode = judul,
 * status = badge, nama = meta.
 */
export function LocationsTable({
  locations,
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
}: LocationsTableProps) {
  const columns: DataColumn<LocationDto>[] = [
    {
      id: 'code',
      header: 'Kode',
      mobile: 'title',
      cell: (location) => (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <LinkCell to="/access/locations/$locationId" params={{ locationId: location.id }}>
            {location.code}
          </LinkCell>
          {location.deleted ? <DeletedBadge /> : null}
        </span>
      ),
    },
    { id: 'name', header: 'Nama', cell: (location) => location.name },
    ...(deletedView
      ? ([
          {
            id: 'deletedBy',
            header: 'Dihapus oleh',
            cell: (location) => location.deleted?.deletedBy ?? '—',
          },
          {
            id: 'deletedAt',
            header: 'Dihapus pada',
            cell: (location) => (location.deleted ? formatStamp(location.deleted.deletedAt) : '—'),
          },
        ] satisfies DataColumn<LocationDto>[])
      : ([
          {
            id: 'status',
            header: 'Status',
            cell: (location) => <ActiveStatusBadge status={location.status} />,
          },
        ] satisfies DataColumn<LocationDto>[])),
  ];

  const actions = (location: LocationDto): RowAction[] => {
    const busy = pendingId === location.id;
    if (location.deleted || deletedView) {
      return [
        {
          id: 'restore',
          action: 'restore',
          label: `Pulihkan ${location.name}`,
          hidden: !canManage,
          busy,
          onSelect: () => onRestore(location),
        },
      ];
    }
    return [
      {
        id: 'edit',
        action: 'edit',
        label: `Ubah ${location.name}`,
        hidden: !canManage,
        onSelect: () => onEdit(location),
      },
      {
        id: 'status',
        action: location.status === 'active' ? 'deactivate' : 'activate',
        label: `${location.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'} ${location.name}`,
        hidden: !canManage,
        busy,
        onSelect: () => onToggleStatus(location),
      },
      {
        id: 'delete',
        action: 'delete',
        label: `Hapus ${location.name}`,
        hidden: !canManage || location.status !== 'inactive',
        busy,
        onSelect: () => onDelete(location),
      },
    ];
  };

  return (
    <DataTable
      rows={locations}
      rowKey={(location) => location.id}
      columns={columns}
      label="Daftar lokasi"
      selectLabel={(location) => location.name}
      selection={selection}
      actions={canManage ? actions : undefined}
      empty="Belum ada lokasi."
      filtered={filtered}
      onClearFilters={onClearFilters}
      emptyAction={emptyAction}
      isLoading={isLoading}
      isError={isError}
      onRetry={onRetry}
    />
  );
}
