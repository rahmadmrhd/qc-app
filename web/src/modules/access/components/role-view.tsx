import type { RoleDto, UserDto } from '@shared/contract';
import { LEVEL_LABELS, levelHint, MODULE_LABELS, MODULES } from '@shared/permissions';
import { LinkCell } from '@/components/data-table';
import { DetailList, ViewMeta, ViewPage, ViewSection } from '@/components/page/view-page';
import { DeletedBadge } from '@/components/soft-delete/deleted-badge';
import { DeletedBanner } from '@/components/soft-delete/deleted-banner';
import { Button } from '@/components/ui/button';
import { ActivityLog } from '@/modules/activity/components/activity-log';
import { roleInUseReason } from './roles-table';

export const ROLE_TABS = ['permissions', 'users'] as const;
export type RoleTab = (typeof ROLE_TABS)[number];

/** Pengguna hidup yang memakai role ini pada penugasan lokasi atau BU. */
export function usersOfRole(users: readonly UserDto[], roleId: string): UserDto[] {
  return users.filter(
    (user) =>
      user.assignments.some((entry) => entry.roleIds.includes(roleId)) ||
      user.buAssignments.some((entry) => entry.roleIds.includes(roleId)),
  );
}

export interface RoleViewProps {
  /** `undefined` = role tidak ada (id salah, atau terhapus bagi yang tak boleh melihatnya). */
  role: RoleDto | undefined;
  /** Daftar pengguna hidup (dari cache daftar pengguna); tab Pengguna menyaring yang memakai role ini. */
  users: readonly UserDto[];
  canManage?: boolean;
  tab?: RoleTab;
  onTabChange?: (tab: RoleTab) => void;
  deletePending?: boolean;
  restorePending?: boolean;
  onBack: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onRestore?: () => void;
}

/** Halaman baca satu role (tab Izin dan Pengguna): tujuan tautan nama role dari daftar dan penugasan. */
export function RoleView({
  role,
  users,
  canManage = false,
  tab,
  onTabChange,
  deletePending = false,
  restorePending = false,
  onBack,
  onEdit,
  onDelete,
  onRestore,
}: RoleViewProps) {
  if (!role) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Role tidak ditemukan</h1>
        <Button variant="outline" color="primary" onClick={onBack}>
          Kembali ke daftar role
        </Button>
      </div>
    );
  }
  const deleted = role.deleted !== undefined;
  const members = usersOfRole(users, role.id);
  return (
    <ViewPage
      title={role.name}
      badge={deleted ? <DeletedBadge /> : undefined}
      tab={tab}
      onTabChange={(id) => onTabChange?.(id as RoleTab)}
      actionItems={
        deleted
          ? [
              {
                id: 'restore',
                action: 'restore',
                busy: restorePending,
                hidden: !(canManage && onRestore),
                onSelect: () => onRestore?.(),
              },
            ]
          : [
              {
                id: 'edit',
                action: 'edit',
                label: 'Ubah',
                hidden: !(canManage && onEdit),
                onSelect: () => onEdit?.(),
              },
              {
                id: 'delete',
                action: 'delete',
                busy: deletePending,
                hidden: !(canManage && onDelete),
                disabled: role.userCount > 0,
                disabledReason: roleInUseReason(role.userCount),
                onSelect: () => onDelete?.(),
              },
            ]
      }
      banner={
        role.deleted ? (
          <DeletedBanner
            info={role.deleted}
            canRestore={canManage}
            {...(onRestore ? { onRestore } : {})}
            restoring={restorePending}
          />
        ) : null
      }
      aside={
        <>
          {role.description ? <p>{role.description}</p> : null}
          <ViewMeta updatedBy={role.updatedBy} updatedAt={role.updatedAt} />
          <ActivityLog kind="role" id={role.id} />
        </>
      }
      tabs={[
        {
          id: 'permissions',
          label: 'Izin',
          content: (
            <ViewSection title="Akses per modul">
              <DetailList
                items={MODULES.map((module) => {
                  const level = role.permissions[module] ?? 'none';
                  return {
                    label: MODULE_LABELS[module],
                    value: (
                      <span>
                        <span className="font-medium">{LEVEL_LABELS[level]}</span>
                        <span className="block text-xs text-muted-foreground">
                          {levelHint(module, level)}
                        </span>
                      </span>
                    ),
                  };
                })}
              />
            </ViewSection>
          ),
        },
        {
          id: 'users',
          label: 'Pengguna',
          content: (
            <ViewSection title="Pengguna dengan role ini">
              {members.length === 0 ? (
                <p className="text-sm text-muted-foreground">Belum ada pengguna.</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {members.map((user) => (
                    <li key={user.id} className="flex flex-wrap items-baseline gap-x-2">
                      <LinkCell to="/access/users/$userId" params={{ userId: user.id }}>
                        {user.email}
                      </LinkCell>
                      <span className="text-muted-foreground">{user.name}</span>
                    </li>
                  ))}
                </ul>
              )}
            </ViewSection>
          ),
        },
      ]}
    />
  );
}
