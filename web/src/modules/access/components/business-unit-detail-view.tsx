import type { BusinessUnitDto } from '@shared/contract';
import { DetailList, ViewMeta, ViewPage, ViewSection } from '@/components/page/view-page';
import { DeletedBadge } from '@/components/soft-delete/deleted-badge';
import { DeletedBanner } from '@/components/soft-delete/deleted-banner';
import { ActiveStatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { ActivityLog } from '@/modules/activity/components/activity-log';

export interface BusinessUnitDetailViewProps {
  /** `undefined` = BU tidak ada (id salah, atau terhapus bagi yang tak boleh melihatnya). */
  businessUnit: BusinessUnitDto | undefined;
  canManage?: boolean;
  statusPending?: boolean;
  restorePending?: boolean;
  onBack: () => void;
  onEdit?: () => void;
  onToggleStatus?: () => void;
  onDelete?: () => void;
  onRestore?: () => void;
}

/** Halaman baca satu Business Unit: tujuan tautan kode dari daftar dan tautan "buka" dari field BU. */
export function BusinessUnitDetailView({
  businessUnit,
  canManage = false,
  statusPending = false,
  restorePending = false,
  onBack,
  onEdit,
  onToggleStatus,
  onDelete,
  onRestore,
}: BusinessUnitDetailViewProps) {
  if (!businessUnit) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">BU tidak ditemukan</h1>
        <Button variant="outline" color="primary" onClick={onBack}>
          Kembali ke daftar BU
        </Button>
      </div>
    );
  }
  const deleted = businessUnit.deleted === true;
  return (
    <ViewPage
      title={businessUnit.name}
      badge={deleted ? <DeletedBadge /> : <ActiveStatusBadge status={businessUnit.status} />}
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
                action: businessUnit.status === 'active' ? 'deactivate' : 'activate',
                busy: statusPending,
                hidden: !(canManage && onToggleStatus),
                onSelect: () => onToggleStatus?.(),
              },
              {
                id: 'delete',
                action: 'delete',
                hidden: !(canManage && onDelete && businessUnit.status === 'inactive'),
                onSelect: () => onDelete?.(),
              },
            ]
      }
      banner={
        deleted && businessUnit.deletedInfo ? (
          <DeletedBanner
            info={businessUnit.deletedInfo}
            canRestore={canManage}
            {...(onRestore ? { onRestore } : {})}
            restoring={restorePending}
          />
        ) : null
      }
      aside={
        <>
          <ViewMeta updatedBy={businessUnit.updatedBy} updatedAt={businessUnit.updatedAt} />
          <ActivityLog kind="businessUnit" id={businessUnit.id} />
        </>
      }
    >
      <ViewSection title="Informasi BU">
        <DetailList
          items={[
            { label: 'Kode', value: businessUnit.code },
            { label: 'Nama', value: businessUnit.name },
            {
              label: 'Status',
              value: deleted ? (
                <DeletedBadge />
              ) : (
                <ActiveStatusBadge status={businessUnit.status} />
              ),
            },
            { label: 'Jumlah item', value: businessUnit.itemCount },
            { label: 'User yang berhak', value: businessUnit.userCount },
          ]}
        />
      </ViewSection>
    </ViewPage>
  );
}
