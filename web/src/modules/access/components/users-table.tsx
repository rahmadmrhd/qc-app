import type { UserDto } from '@shared/contract';
import type { ReactNode } from 'react';
import { type DataColumn, DataTable, LinkCell, type RowAction } from '@/components/data-table';
import type { RowSelection } from '@/components/data-table/use-row-selection';
import { DeletedBadge } from '@/components/soft-delete/deleted-badge';
import { ActiveStatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { formatStamp } from '@/lib/format-stamp';
import type { AssignmentLabels } from '../lib/assignment-labels';
import { deleteLockReason, isProtectedUser, statusLockReason } from '../lib/protected-user';
import { AssignmentChips } from './assignment-chips';

export { SELF_DELETE_REASON, SELF_STATUS_REASON } from '../lib/protected-user';

export interface UsersTableProps {
  users: readonly UserDto[];
  labels: AssignmentLabels;
  /** Tampilan "Terhapus": satu-satunya aksi baris dan massal adalah Pulihkan. */
  deletedView?: boolean;
  canManage: boolean;
  /** Tautan lokasi/BU/role pada penugasan hanya bila pengguna berhak membuka View-nya. */
  canOpenLocation?: boolean;
  canOpenBusinessUnit?: boolean;
  canOpenRole?: boolean;
  currentEmail: string;
  /** Ada = kolom checkbox (hanya bagi pemegang `access: manage`). */
  selection?: RowSelection;
  pendingId?: string | null;
  onEdit: (user: UserDto) => void;
  onToggleStatus: (user: UserDto) => void;
  onDelete: (user: UserDto) => void;
  onRestore: (user: UserDto) => void;
  filtered?: boolean;
  onClearFilters?: () => void;
  emptyAction?: ReactNode;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
}

/**
 * Tabel pengguna (kit CRUD): [checkbox][Aksi][Email -> View + Akun bersama][Nama][Penugasan][Penugasan BU][Status].
 * Di ponsel menjadi kartu: email = judul, status = badge, sisanya meta. Halaman (`routes/_app/access/users/index.tsx`)
 * memegang dialog, filter, dan bar aksi massal.
 */
export function UsersTable({
  users,
  labels,
  deletedView = false,
  canManage,
  canOpenLocation = false,
  canOpenBusinessUnit = false,
  canOpenRole = false,
  currentEmail,
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
}: UsersTableProps) {
  const columns: DataColumn<UserDto>[] = [
    {
      id: 'email',
      header: 'Email',
      mobile: 'title',
      cell: (user) => (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <LinkCell to="/access/users/$userId" params={{ userId: user.id }}>
            {user.email}
          </LinkCell>
          {user.sharedAccount ? (
            <Badge variant="outline" color="primary">
              Akun bersama
            </Badge>
          ) : null}
          {user.deleted ? <DeletedBadge /> : null}
        </span>
      ),
    },
    { id: 'name', header: 'Nama', cell: (user) => user.name },
    {
      id: 'assignments',
      header: 'Penugasan',
      cell: (user) => (
        <AssignmentChips
          kind="location"
          entries={user.assignments.map((entry) => ({
            scopeId: entry.locationId,
            roleIds: entry.roleIds,
          }))}
          labels={labels}
          canOpenScope={canOpenLocation}
          canOpenRole={canOpenRole}
        />
      ),
    },
    {
      id: 'buAssignments',
      header: 'Penugasan BU',
      cell: (user) => (
        <AssignmentChips
          kind="businessUnit"
          entries={user.buAssignments.map((entry) => ({
            scopeId: entry.buId,
            roleIds: entry.roleIds,
          }))}
          labels={labels}
          canOpenScope={canOpenBusinessUnit}
          canOpenRole={canOpenRole}
        />
      ),
    },
    // Tampilan Terhapus (soft delete 4.5): "Dihapus oleh" dan "Dihapus pada" menggantikan Status (selalu Nonaktif).
    ...(deletedView
      ? ([
          {
            id: 'deletedBy',
            header: 'Dihapus oleh',
            cell: (user) => user.deleted?.deletedBy ?? '—',
          },
          {
            id: 'deletedAt',
            header: 'Dihapus pada',
            cell: (user) => (user.deleted ? formatStamp(user.deleted.deletedAt) : '—'),
          },
        ] satisfies DataColumn<UserDto>[])
      : ([
          {
            id: 'status',
            header: 'Status',
            cell: (user) => <ActiveStatusBadge status={user.status} />,
          },
        ] satisfies DataColumn<UserDto>[])),
  ];

  const actions = (user: UserDto): RowAction[] => {
    const busy = pendingId === user.id;
    const protectedUser = isProtectedUser(user, currentEmail);
    const statusLock = statusLockReason(user, currentEmail);
    const deleteLock = deleteLockReason(user, currentEmail);
    if (user.deleted || deletedView) {
      return [
        {
          id: 'restore',
          action: 'restore',
          label: `Pulihkan ${user.email}`,
          hidden: !canManage,
          busy,
          onSelect: () => onRestore(user),
        },
      ];
    }
    return [
      {
        id: 'edit',
        action: 'edit',
        label: `Ubah ${user.email}`,
        hidden: !canManage,
        onSelect: () => onEdit(user),
      },
      {
        id: 'status',
        action: user.status === 'active' ? 'deactivate' : 'activate',
        label: `${user.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'} ${user.email}`,
        hidden: !canManage,
        busy,
        disabled: statusLock !== undefined && user.status === 'active',
        ...(statusLock === undefined ? {} : { disabledReason: statusLock }),
        onSelect: () => onToggleStatus(user),
      },
      {
        id: 'delete',
        action: 'delete',
        label: `Hapus ${user.email}`,
        // Hanya pengguna Nonaktif yang dapat dihapus; akun sendiri dan super admin tetap tampil sebagai aksi
        // nonaktif beralasan.
        hidden: !canManage || (user.status !== 'inactive' && !protectedUser),
        busy,
        disabled: deleteLock !== undefined,
        ...(deleteLock === undefined ? {} : { disabledReason: deleteLock }),
        onSelect: () => onDelete(user),
      },
    ];
  };

  return (
    <DataTable
      rows={users}
      rowKey={(user) => user.id}
      columns={columns}
      label="Daftar pengguna"
      selectLabel={(user) => user.email}
      selection={selection}
      actions={canManage ? actions : undefined}
      empty="Belum ada pengguna."
      filtered={filtered}
      onClearFilters={onClearFilters}
      emptyAction={emptyAction}
      isLoading={isLoading}
      isError={isError}
      onRetry={onRetry}
    />
  );
}
