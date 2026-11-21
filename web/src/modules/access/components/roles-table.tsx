import type { RoleDto } from '@shared/contract';
import type { ReactNode } from 'react';
import { type DataColumn, DataTable, LinkCell, type RowAction } from '@/components/data-table';
import type { RowSelection } from '@/components/data-table/use-row-selection';
import { DeletedBadge } from '@/components/soft-delete/deleted-badge';
import { formatStamp } from '@/lib/format-stamp';
import { PermissionBadges } from './permission-badges';

/** Alasan Hapus nonaktif: role yang masih dipakai pengguna hidup tak dapat dihapus (server: "Role masih dipakai oleh N user"). */
export function roleInUseReason(userCount: number): string {
  return `Role masih dipakai oleh ${userCount} user`;
}

export interface RolesTableProps {
  roles: readonly RoleDto[];
  /** Tampilan "Terhapus": satu-satunya aksi baris dan massal adalah Pulihkan. */
  deletedView?: boolean;
  canManage: boolean;
  /** Ada = kolom checkbox (hanya bagi pemegang `access: manage`). */
  selection?: RowSelection;
  pendingId?: string | null;
  onEdit: (role: RoleDto) => void;
  onDelete: (role: RoleDto) => void;
  onRestore: (role: RoleDto) => void;
  filtered?: boolean;
  onClearFilters?: () => void;
  emptyAction?: ReactNode;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
}

/**
 * Tabel role (kit CRUD): [checkbox][Aksi][Nama -> View][Akses][User]. Role tidak punya status aktif/nonaktif. Di ponsel
 * menjadi kartu: nama = judul, Akses dan User = meta.
 */
export function RolesTable({
  roles,
  deletedView = false,
  canManage,
  selection,
  pendingId = null,
  onEdit,
  onDelete,
  onRestore,
  filtered,
  onClearFilters,
  emptyAction,
  isLoading,
  isError,
  onRetry,
}: RolesTableProps) {
  const columns: DataColumn<RoleDto>[] = [
    {
      id: 'name',
      header: 'Nama',
      mobile: 'title',
      cell: (role) => (
        <div>
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <LinkCell to="/access/roles/$roleId" params={{ roleId: role.id }}>
              {role.name}
            </LinkCell>
            {role.deleted ? <DeletedBadge /> : null}
          </span>
          {role.description ? (
            <div className="text-sm text-muted-foreground">{role.description}</div>
          ) : null}
        </div>
      ),
    },
    {
      id: 'permissions',
      header: 'Akses',
      cell: (role) => <PermissionBadges permissions={role.permissions} />,
    },
    {
      id: 'users',
      header: 'User',
      align: 'right',
      className: 'tabular-nums',
      cell: (role) => role.userCount,
    },
    ...(deletedView
      ? ([
          {
            id: 'deletedBy',
            header: 'Dihapus oleh',
            cell: (role) => role.deleted?.deletedBy ?? '—',
          },
          {
            id: 'deletedAt',
            header: 'Dihapus pada',
            cell: (role) => (role.deleted ? formatStamp(role.deleted.deletedAt) : '—'),
          },
        ] satisfies DataColumn<RoleDto>[])
      : []),
  ];

  const actions = (role: RoleDto): RowAction[] => {
    const busy = pendingId === role.id;
    if (role.deleted || deletedView) {
      return [
        {
          id: 'restore',
          action: 'restore',
          label: `Pulihkan ${role.name}`,
          shortLabel: 'Pulihkan',
          hidden: !canManage,
          busy,
          onSelect: () => onRestore(role),
        },
      ];
    }
    return [
      {
        id: 'edit',
        action: 'edit',
        label: `Ubah ${role.name}`,
        shortLabel: 'Ubah',
        hidden: !canManage,
        onSelect: () => onEdit(role),
      },
      {
        id: 'delete',
        action: 'delete',
        label: `Hapus ${role.name}`,
        shortLabel: 'Hapus',
        hidden: !canManage,
        busy,
        disabled: role.userCount > 0,
        disabledReason: roleInUseReason(role.userCount),
        onSelect: () => onDelete(role),
      },
    ];
  };

  return (
    <DataTable
      rows={roles}
      rowKey={(role) => role.id}
      columns={columns}
      label="Daftar role"
      rowTo={(role) => ({ to: '/access/roles/$roleId', params: { roleId: role.id } })}
      selectLabel={(role) => role.name}
      selection={selection}
      actions={canManage ? actions : undefined}
      empty="Belum ada role."
      filtered={filtered}
      onClearFilters={onClearFilters}
      emptyAction={emptyAction}
      isLoading={isLoading}
      isError={isError}
      onRetry={onRetry}
    />
  );
}
