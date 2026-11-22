import type { StickerDto, StickerTypeDto } from '@shared/contract';
import { Link } from '@tanstack/react-router';
import { DetailList, ViewMeta, ViewPage, ViewSection } from '@/components/page/view-page';
import { DeletedBadge } from '@/components/soft-delete/deleted-badge';
import { DeletedBanner } from '@/components/soft-delete/deleted-banner';
import { ActiveStatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ActivityLog } from '@/modules/activity/components/activity-log';
import { STICKER_RULE_LABEL } from '../schemas';

export interface StickerTypeViewProps {
  /** `undefined` = jenis tidak ada (id salah, atau terhapus bagi yang tak boleh melihatnya). */
  type: StickerTypeDto | undefined;
  /** Stiker hidup pada jenis ini (dari daftar stiker yang sudah dimuat); nama menaut ke View stiker. */
  stickers: readonly StickerDto[];
  canEdit?: boolean;
  canManage?: boolean;
  statusPending?: boolean;
  restorePending?: boolean;
  onBack: () => void;
  onEdit?: () => void;
  onToggleStatus?: () => void;
  onDelete?: () => void;
  onRestore?: () => void;
}

const textLink = 'text-info-text underline-offset-4 hover:underline';

/** Halaman baca satu jenis stiker: tujuan tautan nama jenis dari tabel dan View Stiker. */
export function StickerTypeView({
  type,
  stickers,
  canEdit = false,
  canManage = false,
  statusPending = false,
  restorePending = false,
  onBack,
  onEdit,
  onToggleStatus,
  onDelete,
  onRestore,
}: StickerTypeViewProps) {
  if (!type) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Jenis stiker tidak ditemukan</h1>
        <Button variant="outline" color="primary" onClick={onBack}>
          Kembali ke daftar jenis
        </Button>
      </div>
    );
  }
  const deleted = type.deleted !== undefined;
  const system = type.systemKind !== '';
  const own = stickers.filter((sticker) => sticker.typeId === type.id);
  return (
    <ViewPage
      title={type.name}
      badge={
        <span className="flex flex-wrap items-center gap-2">
          {deleted ? <DeletedBadge /> : <ActiveStatusBadge status={type.status} />}
          {system ? (
            <Badge variant="outline" color="primary">
              Sistem
            </Badge>
          ) : null}
        </span>
      }
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
                hidden: !(canEdit && !system && onEdit),
                onSelect: () => onEdit?.(),
              },
              {
                id: 'status',
                action: type.status === 'active' ? 'deactivate' : 'activate',
                busy: statusPending,
                hidden: !(canManage && !system && onToggleStatus),
                onSelect: () => onToggleStatus?.(),
              },
              {
                id: 'delete',
                action: 'delete',
                hidden: !(canManage && !system && type.status === 'inactive' && onDelete),
                onSelect: () => onDelete?.(),
              },
            ]
      }
      banner={
        type.deleted ? (
          <DeletedBanner
            info={type.deleted}
            canRestore={canManage}
            {...(onRestore ? { onRestore } : {})}
            restoring={restorePending}
          />
        ) : null
      }
      aside={
        <>
          <ViewMeta
            updatedAt={type.updatedAt}
            links={[
              { label: 'Lihat stiker jenis ini', to: '/sticker', search: { typeId: type.id } },
            ]}
          />
          <ActivityLog kind="stickerType" id={type.id} />
        </>
      }
    >
      <ViewSection title="Identitas">
        <DetailList
          items={[
            { label: 'Nama', value: type.name },
            { label: 'Aturan', value: STICKER_RULE_LABEL[type.rule] },
            { label: 'Minimum bawaan', value: type.defaultMinQty },
            {
              label: 'Jenis sistem',
              value: 'Dikelola aplikasi: nama dan aturan tidak dapat diubah, jenis selalu aktif.',
              hidden: !system,
            },
          ]}
        />
      </ViewSection>
      <ViewSection title="Stiker pada jenis ini">
        {own.length === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada stiker pada jenis ini.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {own.map((sticker) => (
              <li key={sticker.id}>
                <Link
                  to="/sticker/$stickerId"
                  params={{ stickerId: sticker.id }}
                  className={textLink}
                >
                  {sticker.alias || sticker.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </ViewSection>
    </ViewPage>
  );
}
