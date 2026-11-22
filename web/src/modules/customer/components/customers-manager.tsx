import type { CustomerDto } from '@shared/contract';
import type { ReactNode } from 'react';
import { type DataColumn, DataTable, LinkCell, type RowAction } from '@/components/data-table';
import type { RowSelection } from '@/components/data-table/use-row-selection';
import { DeletedBadge } from '@/components/soft-delete/deleted-badge';
import { ActiveStatusBadge } from '@/components/status-badge';
import { formatStamp } from '@/lib/format-stamp';

export interface CustomersManagerProps {
  customers: readonly CustomerDto[];
  /** Tampilan "Terhapus": satu-satunya aksi baris dan massal adalah Pulihkan. */
  deletedView?: boolean;
  canManage: boolean;
  /** Ada = kolom checkbox (hanya bagi pemegang `item: manage`). */
  selection?: RowSelection;
  pendingId?: string | null;
  onEdit: (customer: CustomerDto) => void;
  onToggleStatus: (customer: CustomerDto) => void;
  onDelete: (customer: CustomerDto) => void;
  onRestore: (customer: CustomerDto) => void;
  filtered?: boolean;
  onClearFilters?: () => void;
  emptyAction?: ReactNode;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
}

/**
 * Daftar customer (kit CRUD): [checkbox][Aksi][Customer -> View][Status]. Customer baru dibuat otomatis saat task serah
 * terima disimpan, jadi tidak ada tombol Tambah; nama diganti lewat dialog Ubah. Di ponsel menjadi kartu: customer =
 * judul, status = badge.
 */
export function CustomersManager({
  customers,
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
}: CustomersManagerProps) {
  const columns: DataColumn<CustomerDto>[] = [
    {
      id: 'name',
      header: 'Customer',
      mobile: 'title',
      cell: (customer) => (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <LinkCell to="/customer/$customerId" params={{ customerId: customer.id }}>
            {customer.name}
          </LinkCell>
          {customer.deleted ? <DeletedBadge /> : null}
        </span>
      ),
    },
    ...(deletedView
      ? ([
          {
            id: 'deletedBy',
            header: 'Dihapus oleh',
            cell: (customer) => customer.deleted?.deletedBy ?? '—',
          },
          {
            id: 'deletedAt',
            header: 'Dihapus pada',
            cell: (customer) => (customer.deleted ? formatStamp(customer.deleted.deletedAt) : '—'),
          },
        ] satisfies DataColumn<CustomerDto>[])
      : ([
          {
            id: 'status',
            header: 'Status',
            cell: (customer) => <ActiveStatusBadge status={customer.status} />,
          },
        ] satisfies DataColumn<CustomerDto>[])),
  ];

  const actions = (customer: CustomerDto): RowAction[] => {
    const busy = pendingId === customer.id;
    if (customer.deleted || deletedView) {
      return [
        {
          id: 'restore',
          action: 'restore',
          label: `Pulihkan ${customer.name}`,
          shortLabel: 'Pulihkan',
          hidden: !canManage,
          busy,
          onSelect: () => onRestore(customer),
        },
      ];
    }
    return [
      {
        id: 'edit',
        action: 'edit',
        label: `Ubah ${customer.name}`,
        shortLabel: 'Ubah',
        hidden: !canManage,
        onSelect: () => onEdit(customer),
      },
      {
        id: 'status',
        action: customer.status === 'active' ? 'deactivate' : 'activate',
        label: `${customer.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'} ${customer.name}`,
        shortLabel: customer.status === 'active' ? 'Nonaktifkan' : 'Aktifkan',
        hidden: !canManage,
        busy,
        onSelect: () => onToggleStatus(customer),
      },
      {
        id: 'delete',
        action: 'delete',
        label: `Hapus ${customer.name}`,
        shortLabel: 'Hapus',
        hidden: !canManage || customer.status !== 'inactive',
        busy,
        onSelect: () => onDelete(customer),
      },
    ];
  };

  return (
    <DataTable
      rows={customers}
      rowKey={(customer) => customer.id}
      columns={columns}
      label="Daftar customer"
      rowTo={(customer) => ({ to: '/customer/$customerId', params: { customerId: customer.id } })}
      selectLabel={(customer) => customer.name}
      selection={selection}
      actions={canManage ? actions : undefined}
      empty="Belum ada customer. Customer dibuat otomatis saat task serah terima disimpan."
      filtered={filtered}
      onClearFilters={onClearFilters}
      emptyAction={emptyAction}
      isLoading={isLoading}
      isError={isError}
      onRetry={onRetry}
    />
  );
}
