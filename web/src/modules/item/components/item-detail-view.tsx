import type { ItemDto, ItemPostelDto } from '@shared/contract';
import { firmwareOptionsFor } from '@shared/firmware';
import { ActionButton } from '@/components/action-button';
import { DetailList, ViewMeta, ViewPage, ViewSection } from '@/components/page/view-page';
import { DeletedBadge } from '@/components/soft-delete/deleted-badge';
import { DeletedBanner } from '@/components/soft-delete/deleted-banner';
import { ActiveStatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { MarkdownView } from '@/modules/markdown/markdown-view';
import { PostelConditionBadge } from '@/modules/postel/components/postel-condition-badge';
import { formatPostelDate } from '@/modules/postel/lib/condition';
import { STICKER_STATUS_LABEL } from '@/modules/sticker/lib/status';
import { ImageThumb } from './image-thumb';
import { NoManualBookNote } from './manual-book-note';
import { NoPostelNote } from './no-postel-note';
import { StickerInstructionsView } from './sticker-instructions-view';

export const ITEM_TABS = ['detail', 'gambar', 'stiker', 'manual-postel'] as const;
export type ItemTab = (typeof ITEM_TABS)[number];

export interface ItemDetailViewProps {
  item: ItemDto;
  canEdit: boolean;
  canManage: boolean;
  /** Boleh memulihkan item terhapus (pemegang `manage`). */
  canRestore?: boolean;
  /** Boleh membuka daftar Serial Number (`serial: view`): tautan "Lihat Serial Number item ini". */
  canViewSerial?: boolean;
  statusPending: boolean;
  restorePending?: boolean;
  /** Tautan ke View merk / BU; tidak diberikan bila user tak berhak membukanya. */
  openBrandHref?: ((brandId: string) => string) | undefined;
  openBusinessUnitHref?: ((buId: string) => string) | undefined;
  /** Tautan ke konfigurasi QR Manual Book item ini; tidak diberikan bila user tak berhak membukanya. */
  openManualBookHref?: ((designId: string) => string | null) | undefined;
  /**
   * Postel item: `undefined` = user tak boleh melihat Postel (`sticker: view`; bagian disembunyikan, jangan disimpulkan
   * dari `null` karena server juga mengirim `null` bagi yang tak berhak), `null` = belum ada Postel.
   */
  postel?: ItemPostelDto | null | undefined;
  /** Tautan ke halaman Postel; tidak diberikan/`null` bila user tak berhak membukanya. */
  openPostelHref?: ((postelId: string) => string | null) | undefined;
  /** Tab aktif terkendali (search param `tab`). */
  tab?: ItemTab | undefined;
  onTabChange?: ((tab: ItemTab) => void) | undefined;
  onEdit: () => void;
  onToggleStatus: () => void;
  onDelete?: (() => void) | undefined;
  onRestore?: (() => void) | undefined;
}

const textLink = 'text-info-text underline-offset-4 hover:underline';

/** Halaman baca-saja item; QC memakai tab Instruksi Stiker sebagai acuan kerja. */
export function ItemDetailView({
  item,
  canEdit,
  canManage,
  canRestore = false,
  canViewSerial = false,
  statusPending,
  restorePending = false,
  openBrandHref,
  openBusinessUnitHref,
  openManualBookHref,
  postel,
  openPostelHref,
  tab,
  onTabChange,
  onEdit,
  onToggleStatus,
  onDelete,
  onRestore,
}: ItemDetailViewProps) {
  const deleted = item.deleted !== undefined;
  const postelHref = postel ? (openPostelHref?.(postel.id) ?? null) : null;
  // Merk terhapus: View-nya hanya terbuka bagi pemegang izin Pulihkan (soft delete 4.4).
  const brandHref = item.brandDeleted && !canRestore ? undefined : openBrandHref?.(item.brandId);
  const firmwareLabel =
    item.firmware === ''
      ? ''
      : (firmwareOptionsFor(item.brand).find((o) => o.code === item.firmware)?.label ??
        item.firmware);

  const detailTab = (
    <div className="space-y-6">
      <ViewSection title="Identitas">
        <DetailList
          items={[
            {
              label: 'Merk',
              value: (
                <span className="inline-flex flex-wrap items-center gap-2">
                  {brandHref ? (
                    <a href={brandHref} className={textLink}>
                      {item.brand}
                    </a>
                  ) : (
                    item.brand
                  )}
                  {item.brandDeleted ? <DeletedBadge /> : null}
                </span>
              ),
            },
            { label: 'Tipe', value: item.model },
            {
              label: 'Business Unit',
              value:
                item.businessUnits.length === 0 ? null : (
                  <span className="inline-flex flex-wrap gap-2">
                    {item.businessUnits.map((bu) => {
                      const href = openBusinessUnitHref?.(bu.id);
                      return href ? (
                        <a key={bu.id} href={href} title={bu.name} className={textLink}>
                          {bu.code}
                        </a>
                      ) : (
                        <Badge key={bu.id} variant="outline" title={bu.name}>
                          {bu.code}
                        </Badge>
                      );
                    })}
                  </span>
                ),
            },
            { label: 'Nama lain', value: item.aliases.join(', ') },
            { label: 'Country lock', value: item.isCountryLock ? 'Ya' : 'Tidak' },
            { label: 'Firmware', value: firmwareLabel, hidden: !item.isCountryLock },
            {
              label: 'Wajib foto bukti',
              value: item.proofRequired ? `Ya (min ${item.proofMin})` : 'Tidak',
            },
          ]}
        />
      </ViewSection>

      <ViewSection title="Kelengkapan aksesoris">
        {item.accessories.length === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada kelengkapan.</p>
        ) : (
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {item.accessories.map((accessory, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: nama kelengkapan boleh sama; urutan tetap
              <li key={index}>{`${accessory.name} ×${accessory.qty}`}</li>
            ))}
          </ul>
        )}
      </ViewSection>

      <ViewSection title="Detail dan spesifikasi">
        {item.detail.trim() === '' ? (
          <p className="text-sm text-muted-foreground">Belum ada detail.</p>
        ) : (
          <MarkdownView source={item.detail} />
        )}
      </ViewSection>
    </div>
  );

  const imagesTab = (
    <ViewSection title="Gambar lampiran">
      {item.attachments.length === 0 ? (
        <p className="text-sm text-muted-foreground">Belum ada gambar.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
          {item.attachments.map((id, index) => (
            <li key={id}>
              <ImageThumb id={id} alt={`Gambar ${index + 1}`} className="aspect-square w-full" />
            </li>
          ))}
        </ul>
      )}
    </ViewSection>
  );

  const stickerTab = (
    <StickerInstructionsView
      photos={item.stickerPhotos}
      canEdit={canEdit && !deleted}
      editHref={`/item/${encodeURIComponent(item.id)}/edit`}
      onEdit={onEdit}
      buLabels={Object.fromEntries(item.businessUnits.map((bu) => [bu.id, bu.code]))}
      multiBu={item.businessUnits.length > 1}
    />
  );

  const manualHref = item.manualBook ? openManualBookHref?.(item.manualBook.designId) : null;
  const manualPostelTab = (
    <div className="space-y-6">
      <ViewSection title="Manual Book">
        {item.manualBook === null ? (
          <NoManualBookNote className="text-sm" />
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{item.manualBook.name}</span>
            <Badge variant="outline">{`v${item.manualBook.version}`}</Badge>
            <ActiveStatusBadge
              status={item.manualBook.status}
              label={STICKER_STATUS_LABEL[item.manualBook.status]}
            />
            {manualHref ? (
              <a href={manualHref} className={textLink}>
                Buka konfigurasi QR
              </a>
            ) : null}
          </div>
        )}
      </ViewSection>

      {postel === undefined ? (
        // Tanpa `sticker: view` ringkasan Postel disembunyikan (spek 4b butir 10), tetapi keterangan "Belum ada
        // Postel" tampil bagi semua pembaca item seperti Manual Book (keputusan pemilik 2026-11-12).
        item.hasPostel ? null : (
          <ViewSection title="Postel">
            <NoPostelNote className="text-sm" />
          </ViewSection>
        )
      ) : (
        <ViewSection title="Postel">
          {postel === null ? (
            <NoPostelNote className="text-sm" />
          ) : (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{postel.name}</span>
              <Badge variant="outline">{postel.number}</Badge>
              <span className="text-muted-foreground">
                Berlaku sampai {formatPostelDate(postel.expiresOn)}
              </span>
              <PostelConditionBadge condition={postel.condition} />
              {postelHref ? (
                <a href={postelHref} className={textLink}>
                  Buka Postel
                </a>
              ) : null}
            </div>
          )}
        </ViewSection>
      )}
    </div>
  );

  return (
    <ViewPage
      title={`${item.brand} ${item.model}`}
      badge={deleted ? <DeletedBadge /> : <ActiveStatusBadge status={item.status} />}
      actionItems={
        deleted
          ? [
              {
                id: 'restore',
                action: 'restore',
                busy: restorePending,
                hidden: !(canRestore && onRestore),
                onSelect: () => onRestore?.(),
              },
            ]
          : [
              { id: 'edit', action: 'edit', label: 'Ubah', hidden: !canEdit, onSelect: onEdit },
              {
                id: 'status',
                action: item.status === 'active' ? 'deactivate' : 'activate',
                busy: statusPending,
                hidden: !canManage,
                onSelect: onToggleStatus,
              },
              {
                id: 'delete',
                action: 'delete',
                hidden: !(canManage && item.status === 'inactive' && onDelete),
                onSelect: () => onDelete?.(),
              },
            ]
      }
      banner={
        item.deleted ? (
          <DeletedBanner
            info={item.deleted}
            canRestore={canRestore}
            {...(onRestore ? { onRestore } : {})}
            restoring={restorePending}
          />
        ) : null
      }
      tabs={[
        { id: 'detail', label: 'Detail', content: detailTab },
        { id: 'gambar', label: 'Gambar', content: imagesTab },
        { id: 'stiker', label: 'Instruksi Stiker', content: stickerTab },
        { id: 'manual-postel', label: 'Manual Book & Postel', content: manualPostelTab },
      ]}
      {...(tab ? { tab } : {})}
      onTabChange={(id) => onTabChange?.(id as ItemTab)}
      aside={
        <ViewMeta
          createdAt={item.createdAt}
          updatedBy={item.updatedBy}
          updatedAt={item.updatedAt}
          links={
            canViewSerial
              ? [
                  {
                    label: 'Lihat Serial Number item ini',
                    to: '/serial',
                    search: { item: item.id, itemLabel: `${item.brand} ${item.model}` },
                  },
                ]
              : []
          }
        />
      }
    />
  );
}
