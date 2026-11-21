import type { UserDto } from '@shared/contract';
import { DetailList, ViewMeta, ViewPage, ViewSection } from '@/components/page/view-page';
import { DeletedBadge } from '@/components/soft-delete/deleted-badge';
import { DeletedBanner } from '@/components/soft-delete/deleted-banner';
import { ActiveStatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { AssignmentLabels } from '../lib/assignment-labels';
import { deleteLockReason, isProtectedUser, statusLockReason } from '../lib/protected-user';
import { AssignmentChips } from './assignment-chips';

export const USER_TABS = ['detail', 'locations', 'businessUnits'] as const;
export type UserTab = (typeof USER_TABS)[number];

export interface UserViewProps {
  /** `undefined` = pengguna tidak ada (id salah, atau terhapus bagi yang tak boleh melihatnya). */
  user: UserDto | undefined;
  labels: AssignmentLabels;
  canManage?: boolean;
  canOpenLocation?: boolean;
  canOpenBusinessUnit?: boolean;
  canOpenRole?: boolean;
  currentEmail: string;
  tab?: UserTab;
  onTabChange?: (tab: UserTab) => void;
  statusPending?: boolean;
  restorePending?: boolean;
  onBack: () => void;
  onEdit?: () => void;
  onToggleStatus?: () => void;
  onDelete?: () => void;
  onRestore?: () => void;
}

/** Halaman baca satu pengguna (tab Detail, Penugasan lokasi, Penugasan BU): tujuan tautan email dari daftar. */
export function UserView({
  user,
  labels,
  canManage = false,
  canOpenLocation = false,
  canOpenBusinessUnit = false,
  canOpenRole = false,
  currentEmail,
  tab,
  onTabChange,
  statusPending = false,
  restorePending = false,
  onBack,
  onEdit,
  onToggleStatus,
  onDelete,
  onRestore,
}: UserViewProps) {
  if (!user) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Pengguna tidak ditemukan</h1>
        <Button variant="outline" onClick={onBack}>
          Kembali ke daftar pengguna
        </Button>
      </div>
    );
  }
  const deleted = user.deleted !== undefined;
  const protectedUser = isProtectedUser(user, currentEmail);
  const statusLock = statusLockReason(user, currentEmail);
  const deleteLock = deleteLockReason(user, currentEmail);
  return (
    <ViewPage
      title={user.email}
      badge={deleted ? <DeletedBadge /> : <ActiveStatusBadge status={user.status} />}
      tab={tab}
      onTabChange={(id) => onTabChange?.(id as UserTab)}
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
                id: 'status',
                action: user.status === 'active' ? 'deactivate' : 'activate',
                busy: statusPending,
                hidden: !(canManage && onToggleStatus),
                disabled: statusLock !== undefined && user.status === 'active',
                ...(statusLock === undefined ? {} : { disabledReason: statusLock }),
                onSelect: () => onToggleStatus?.(),
              },
              {
                id: 'delete',
                action: 'delete',
                hidden: !(canManage && onDelete && (user.status === 'inactive' || protectedUser)),
                disabled: deleteLock !== undefined,
                ...(deleteLock === undefined ? {} : { disabledReason: deleteLock }),
                onSelect: () => onDelete?.(),
              },
            ]
      }
      banner={
        user.deleted ? (
          <DeletedBanner
            info={user.deleted}
            canRestore={canManage}
            {...(onRestore ? { onRestore } : {})}
            restoring={restorePending}
          />
        ) : null
      }
      aside={<ViewMeta updatedBy={user.updatedBy} updatedAt={user.updatedAt} />}
      tabs={[
        {
          id: 'detail',
          label: 'Detail',
          content: (
            <ViewSection title="Identitas">
              <DetailList
                items={[
                  { label: 'Email', value: user.email },
                  { label: 'Nama', value: user.name },
                  {
                    label: 'Status',
                    value: deleted ? <DeletedBadge /> : <ActiveStatusBadge status={user.status} />,
                  },
                  {
                    label: 'Akun bersama',
                    value: user.sharedAccount ? (
                      <Badge variant="outline">Akun bersama</Badge>
                    ) : (
                      'Tidak'
                    ),
                  },
                ]}
              />
            </ViewSection>
          ),
        },
        {
          id: 'locations',
          label: 'Penugasan lokasi',
          content: (
            <ViewSection title="Penugasan lokasi">
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
            </ViewSection>
          ),
        },
        {
          id: 'businessUnits',
          label: 'Penugasan BU',
          content: (
            <ViewSection title="Penugasan BU">
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
            </ViewSection>
          ),
        },
      ]}
    />
  );
}
