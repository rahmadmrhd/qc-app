import type { BrandDto, BusinessUnitOptionDto } from '@shared/contract';
import { Link } from '@tanstack/react-router';
import { DetailList, ViewMeta, ViewPage, ViewSection } from '@/components/page/view-page';
import { DeletedBadge } from '@/components/soft-delete/deleted-badge';
import { DeletedBanner } from '@/components/soft-delete/deleted-banner';
import { ActiveStatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export interface BrandDetailViewProps {
  /** `undefined` = merk tidak ada (id salah, sudah dihapus, atau tak boleh dilihat). */
  brand: BrandDto | undefined;
  businessUnits: readonly BusinessUnitOptionDto[];
  canEdit?: boolean;
  canManage?: boolean;
  /** Kode BU bawaan menaut ke halaman BU hanya bila pengguna berhak. */
  canOpenBusinessUnit?: boolean;
  statusPending?: boolean;
  restorePending?: boolean;
  onBack: () => void;
  onEdit?: () => void;
  onToggleStatus?: () => void;
  onDelete?: () => void;
  onRestore?: () => void;
}

const textLink = 'text-info-text underline-offset-4 hover:underline';

/** Halaman baca satu merk: tujuan tautan "buka" dari field Merk dan dari tabel merk/item. */
export function BrandDetailView({
  brand,
  businessUnits,
  canEdit = false,
  canManage = false,
  canOpenBusinessUnit = true,
  statusPending = false,
  restorePending = false,
  onBack,
  onEdit,
  onToggleStatus,
  onDelete,
  onRestore,
}: BrandDetailViewProps) {
  if (!brand) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Merk tidak ditemukan</h1>
        <Button variant="outline" color="primary" onClick={onBack}>
          Kembali ke daftar merk
        </Button>
      </div>
    );
  }
  const deleted = brand.deleted !== undefined;
  const defaults = brand.businessUnitIds.map(
    (id) => businessUnits.find((bu) => bu.id === id) ?? { id, code: id, name: id },
  );
  return (
    <ViewPage
      title={brand.name}
      badge={deleted ? <DeletedBadge /> : <ActiveStatusBadge status={brand.status} />}
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
                hidden: !(canEdit && onEdit),
                onSelect: () => onEdit?.(),
              },
              {
                id: 'status',
                action: brand.status === 'active' ? 'deactivate' : 'activate',
                busy: statusPending,
                hidden: !(canManage && onToggleStatus),
                onSelect: () => onToggleStatus?.(),
              },
              {
                id: 'delete',
                action: 'delete',
                hidden: !(canManage && brand.status === 'inactive' && onDelete),
                onSelect: () => onDelete?.(),
              },
            ]
      }
      banner={
        brand.deleted ? (
          <DeletedBanner
            info={brand.deleted}
            canRestore={canManage}
            {...(onRestore ? { onRestore } : {})}
            restoring={restorePending}
          />
        ) : null
      }
      aside={
        <ViewMeta
          updatedAt={brand.updatedAt}
          links={[{ label: 'Lihat item merk ini', to: '/item', search: { brandId: brand.id } }]}
        />
      }
    >
      <ViewSection title="Identitas">
        <DetailList
          items={[
            { label: 'Nama', value: brand.name },
            {
              label: 'BU bawaan',
              value:
                defaults.length === 0 ? null : (
                  <span className="flex flex-wrap gap-2">
                    {defaults.map((bu) =>
                      canOpenBusinessUnit ? (
                        <Link
                          key={bu.id}
                          to="/access/business-units/$businessUnitId"
                          params={{ businessUnitId: bu.id }}
                          title={bu.name}
                          className={textLink}
                        >
                          {bu.code}
                        </Link>
                      ) : (
                        <Badge key={bu.id} variant="outline" color="primary" title={bu.name}>
                          {bu.code}
                        </Badge>
                      ),
                    )}
                  </span>
                ),
            },
            {
              label: 'Jumlah item',
              value:
                brand.itemCount === 0 ? (
                  0
                ) : (
                  <Link to="/item" search={{ brandId: brand.id }} className={textLink}>
                    {brand.itemCount}
                  </Link>
                ),
            },
          ]}
        />
      </ViewSection>
    </ViewPage>
  );
}
