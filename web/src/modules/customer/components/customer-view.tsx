import type { CustomerDto } from '@shared/contract';
import { PageContent } from '@/components/page/page-container';
import { DetailList, ViewMeta, ViewPage, ViewSection } from '@/components/page/view-page';
import { DeletedBadge } from '@/components/soft-delete/deleted-badge';
import { DeletedBanner } from '@/components/soft-delete/deleted-banner';
import { ActiveStatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { ActivityLog } from '@/modules/activity/components/activity-log';

export interface CustomerViewProps {
  /** `undefined` = customer tidak ada (id salah, atau terhapus bagi yang tak boleh melihatnya). */
  customer: CustomerDto | undefined;
  canManage?: boolean;
  /** Pemegang `handover: view`: tampilkan tautan ke papan Serah Terima yang disaring customer ini. */
  canViewHandovers?: boolean;
  statusPending?: boolean;
  restorePending?: boolean;
  onBack: () => void;
  onEdit?: () => void;
  onToggleStatus?: () => void;
  onDelete?: () => void;
  onRestore?: () => void;
}

/** Halaman baca satu customer: tujuan tautan nama customer dari daftar dan dari task serah terima. */
export function CustomerView({
  customer,
  canManage = false,
  canViewHandovers = false,
  statusPending = false,
  restorePending = false,
  onBack,
  onEdit,
  onToggleStatus,
  onDelete,
  onRestore,
}: CustomerViewProps) {
  if (!customer) {
    return (
      <PageContent className="space-y-4">
        <h1 className="text-2xl font-semibold">Customer tidak ditemukan</h1>
        <Button variant="outline" color="primary" onClick={onBack}>
          Kembali ke daftar customer
        </Button>
      </PageContent>
    );
  }
  const deleted = customer.deleted !== undefined;
  return (
    <ViewPage
      title={customer.name}
      badge={deleted ? <DeletedBadge /> : <ActiveStatusBadge status={customer.status} />}
      actionItems={
        deleted
          ? [
              {
                id: 'restore',
                primary: true,
                action: 'restore',
                busy: restorePending,
                hidden: !(canManage && onRestore),
                onSelect: () => onRestore?.(),
              },
            ]
          : [
              {
                id: 'edit',
                primary: true,
                action: 'edit',
                label: 'Ubah',
                hidden: !(canManage && onEdit),
                onSelect: () => onEdit?.(),
              },
              {
                id: 'status',
                primary: true,
                action: customer.status === 'active' ? 'deactivate' : 'activate',
                busy: statusPending,
                hidden: !(canManage && onToggleStatus),
                onSelect: () => onToggleStatus?.(),
              },
              {
                id: 'delete',
                action: 'delete',
                hidden: !(canManage && onDelete && customer.status === 'inactive'),
                onSelect: () => onDelete?.(),
              },
            ]
      }
      banner={
        customer.deleted ? (
          <DeletedBanner
            info={customer.deleted}
            canRestore={canManage}
            {...(onRestore ? { onRestore } : {})}
            restoring={restorePending}
          />
        ) : null
      }
      aside={
        <>
          <ViewMeta
            updatedAt={customer.updatedAt}
            links={
              canViewHandovers
                ? [
                    {
                      label: 'Lihat task Serah Terima customer ini',
                      to: '/handover',
                      search: { customer: customer.id },
                    },
                  ]
                : []
            }
          />
          <ActivityLog kind="customer" id={customer.id} />
        </>
      }
    >
      <ViewSection title="Identitas">
        <DetailList
          items={[
            { label: 'Nama', value: customer.name },
            {
              label: 'Status',
              value: deleted ? <DeletedBadge /> : <ActiveStatusBadge status={customer.status} />,
            },
          ]}
        />
      </ViewSection>
    </ViewPage>
  );
}
