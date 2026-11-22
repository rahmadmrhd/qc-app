import type { LocationDto } from '@shared/contract';
import { PageContent } from '@/components/page/page-container';
import type { ViewMetaLink } from '@/components/page/view-page';
import { DetailList, ViewMeta, ViewPage, ViewSection } from '@/components/page/view-page';
import { DeletedBadge } from '@/components/soft-delete/deleted-badge';
import { DeletedBanner } from '@/components/soft-delete/deleted-banner';
import { ActiveStatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { ActivityLog } from '@/modules/activity/components/activity-log';

export interface LocationViewProps {
  /** `undefined` = lokasi tidak ada (id salah, atau terhapus bagi yang tak boleh melihatnya). */
  location: LocationDto | undefined;
  canManage?: boolean;
  /** Tautan "Data terkait" hanya bagi pengguna yang berhak membuka tujuannya. */
  canOpenSerials?: boolean;
  canOpenStock?: boolean;
  statusPending?: boolean;
  restorePending?: boolean;
  onBack: () => void;
  onEdit?: () => void;
  onToggleStatus?: () => void;
  onDelete?: () => void;
  onRestore?: () => void;
}

/** Halaman baca satu lokasi: tujuan tautan kode dari daftar dan dari penugasan lokasi pengguna. */
export function LocationView({
  location,
  canManage = false,
  canOpenSerials = false,
  canOpenStock = false,
  statusPending = false,
  restorePending = false,
  onBack,
  onEdit,
  onToggleStatus,
  onDelete,
  onRestore,
}: LocationViewProps) {
  if (!location) {
    return (
      <PageContent className="space-y-4">
        <h1 className="text-2xl font-semibold">Lokasi tidak ditemukan</h1>
        <Button variant="outline" color="primary" onClick={onBack}>
          Kembali ke daftar lokasi
        </Button>
      </PageContent>
    );
  }
  const deleted = location.deleted !== undefined;
  const links: ViewMetaLink[] = [];
  if (canOpenSerials) {
    links.push({
      label: 'Serial Number di lokasi ini',
      to: '/serial',
      search: { loc: location.id },
    });
  }
  if (canOpenStock) links.push({ label: 'Stok stiker', to: '/sticker' });
  return (
    <ViewPage
      title={location.name}
      badge={deleted ? <DeletedBadge /> : <ActiveStatusBadge status={location.status} />}
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
                action: location.status === 'active' ? 'deactivate' : 'activate',
                busy: statusPending,
                hidden: !(canManage && onToggleStatus),
                onSelect: () => onToggleStatus?.(),
              },
              {
                id: 'delete',
                action: 'delete',
                hidden: !(canManage && onDelete && location.status === 'inactive'),
                onSelect: () => onDelete?.(),
              },
            ]
      }
      banner={
        location.deleted ? (
          <DeletedBanner
            info={location.deleted}
            canRestore={canManage}
            {...(onRestore ? { onRestore } : {})}
            restoring={restorePending}
          />
        ) : null
      }
      aside={
        <>
          <ViewMeta updatedBy={location.updatedBy} updatedAt={location.updatedAt} links={links} />
          <ActivityLog kind="location" id={location.id} />
        </>
      }
    >
      <ViewSection title="Informasi lokasi">
        <DetailList
          items={[
            { label: 'Kode', value: location.code },
            { label: 'Nama', value: location.name },
            {
              label: 'Status',
              value: deleted ? <DeletedBadge /> : <ActiveStatusBadge status={location.status} />,
            },
          ]}
        />
      </ViewSection>
    </ViewPage>
  );
}
