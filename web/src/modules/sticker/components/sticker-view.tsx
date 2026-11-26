import { formatBuLabel } from '@shared/business-units';
import type { BusinessUnitOptionDto, StickerDto, StickerTypeDto } from '@shared/contract';
import { formatStockQty } from '@shared/stickers';
import { Link } from '@tanstack/react-router';
import { PageContent } from '@/components/page/page-container';
import {
  DetailList,
  type ViewAction,
  ViewMeta,
  ViewPage,
  ViewSection,
  type ViewTab,
} from '@/components/page/view-page';
import { DeletedBadge } from '@/components/soft-delete/deleted-badge';
import { DeletedBanner } from '@/components/soft-delete/deleted-banner';
import { ActiveStatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ActivityLog } from '@/modules/activity/components/activity-log';
import { ImageThumb } from '@/modules/item/components/image-thumb';
import { STICKER_STATUS_LABEL } from '../lib/status';
import {
  type StickerStockPanel,
  type StockActionsController,
  stockAvailability,
} from './stock-actions';
import { StockHistoryPanel } from './stock-history';

export const STICKER_TABS = ['detail', 'stok', 'riwayat'] as const;
export type StickerTab = (typeof STICKER_TABS)[number];

export interface StickerViewProps {
  /** `undefined` = stiker tidak ada (id salah, atau terhapus bagi yang tak boleh melihatnya). */
  sticker: StickerDto | undefined;
  /** Jenis stiker ini (bila ada di daftar jenis hidup): menentukan jenis sistem dan aturan hapus/aktifkan. */
  type: StickerTypeDto | undefined;
  businessUnits: readonly BusinessUnitOptionDto[];
  /** Stok per lokasi; kosong (tanpa `stickerstock: view`) = tab Stok dan Riwayat tidak ada. */
  stock?: StickerStockPanel | undefined;
  /** Pengendali dialog stok bersama (`useStockActions`); dirender oleh halaman. */
  stockActions?: StockActionsController | undefined;
  canEdit?: boolean;
  canManage?: boolean;
  /** Kode BU menaut ke halaman BU hanya bila pengguna berhak. */
  canOpenBusinessUnit?: boolean;
  /** Tautan ke halaman lihat catatan Postel; `null` = tanpa izin atau aplikasi desktop (tanpa tautan). */
  openPostelHref?: ((postelId: string) => string | null) | undefined;
  /** Tautan ke halaman lihat konfigurasi QR Manual Book; `undefined` = tanpa izin atau aplikasi desktop. */
  openManualBookHref?: ((designId: string) => string) | undefined;
  statusPending?: boolean;
  restorePending?: boolean;
  tab?: StickerTab | undefined;
  onTabChange?: ((tab: StickerTab) => void) | undefined;
  onBack: () => void;
  onEdit?: () => void;
  onToggleStatus?: () => void;
  onDelete?: () => void;
  onRestore?: () => void;
  /** Membuka halaman stok opname untuk stiker ini (`/sticker/opname?sticker=<id>`). */
  onStartOpname?: (stickerId: string) => void;
  /** Membuka halaman "Entri stok" dengan stiker ini sudah masuk entri awal. */
  onStartEntry?: (stickerId: string) => void;
}

const SYSTEM_ORIGIN: Record<string, string> = {
  manual_book:
    'Stiker Manual Book: dibuat otomatis saat konfigurasi QR diekspor, satu per versi label.',
  postel: 'Stiker Postel: satu untuk tiap catatan Postel, namanya mengikuti nama Postel.',
};

const textLink = 'text-info-text underline-offset-4 hover:underline';

/**
 * Halaman baca satu stiker (kit CRUD): tab Detail (identitas stiker) selalu ada; tab Stok (total, rincian per lokasi,
 * aksi stok) dan Riwayat hanya bagi pemegang `stickerstock: view` di lokasi terpilih dan tidak untuk stiker terhapus.
 */
export function StickerView({
  sticker,
  type,
  businessUnits,
  stock,
  stockActions,
  canEdit = false,
  canManage = false,
  canOpenBusinessUnit = true,
  openPostelHref,
  openManualBookHref,
  statusPending = false,
  restorePending = false,
  tab,
  onTabChange,
  onBack,
  onEdit,
  onToggleStatus,
  onDelete,
  onRestore,
  onStartOpname,
  onStartEntry,
}: StickerViewProps) {
  if (!sticker) {
    return (
      <PageContent className="space-y-4">
        <h1 className="text-2xl font-semibold">Stiker tidak ditemukan</h1>
        <Button variant="outline" color="primary" onClick={onBack}>
          Kembali ke daftar stiker
        </Button>
      </PageContent>
    );
  }
  const deleted = sticker.deleted !== undefined;
  const label = sticker.alias === '' ? sticker.name : sticker.alias;
  const systemKind = type?.systemKind ?? '';
  const buItems = sticker.businessUnitIds.map(
    (id) => businessUnits.find((bu) => bu.id === id) ?? { id, code: id, name: id },
  );
  // Aktifkan kembali: Usang hanya dapat menjadi nonaktif; Manual Book nonaktif hanya bila versi terbaru konfigurasinya.
  const canToggle =
    sticker.status !== 'inactive' ||
    systemKind !== 'manual_book' ||
    sticker.latestManualBookVersion;
  // Sumber hidup (id hanya terisi bila Postel/konfigurasi QR-nya belum terhapus; server yang menentukan).
  const sourceLink = ((): { href: string; label: string } | null => {
    if (sticker.postelId) {
      const href = openPostelHref?.(sticker.postelId);
      return href ? { href, label: 'Buka Postel' } : null;
    }
    if (sticker.manualBookDesignId) {
      const href = openManualBookHref?.(sticker.manualBookDesignId);
      return href ? { href, label: 'Buka Manual Book' } : null;
    }
    return null;
  })();
  const stockRow = stock?.rows.find((row) => row.stickerId === sticker.id);
  const showStock = stock !== undefined && !deleted;

  // Aksi stok ada di header (satu entri "Stok" bersubmenu, seperti kolom Aksi daftar): desktop satu dropdown, ponsel grup
  // datar di menu "Aksi lainnya". Tab Stok tinggal menampilkan angkanya.
  const stockEntry = ((): ViewAction | null => {
    if (!showStock || !stock) return null;
    const { canIn, canOut, canAdjust } = stockRow
      ? stockAvailability(stock, stockRow)
      : { canIn: false, canOut: false, canAdjust: false };
    const open = (mode: 'in' | 'out' | 'adjust') => () => stockActions?.openEntry(mode, sticker.id);
    const submenu: ViewAction[] = [
      {
        id: 'stock-in',
        action: 'stockIn',
        hidden: !(canIn && stockRow && stockActions),
        onSelect: open('in'),
      },
      {
        id: 'stock-out',
        action: 'stockOut',
        hidden: !(canOut && stockRow && stockActions),
        onSelect: open('out'),
      },
      {
        id: 'stock-adjust',
        action: 'adjust',
        hidden: !(canAdjust && stockRow && stockActions),
        onSelect: open('adjust'),
      },
      {
        id: 'stock-entry',
        action: 'stock',
        label: 'Entri stok',
        hidden: !((stock.canEdit || stock.canManage) && onStartEntry),
        onSelect: () => onStartEntry?.(sticker.id),
      },
      {
        id: 'stock-opname',
        action: 'adjust',
        label: 'Stok opname',
        hidden: !(stock.canManage && onStartOpname),
        onSelect: () => onStartOpname?.(sticker.id),
      },
    ];
    return {
      id: 'stock',
      action: 'stock',
      primary: true,
      hidden: submenu.every((entry) => entry.hidden),
      onSelect: () => undefined,
      submenu,
    };
  })();

  const actionItems: ViewAction[] = deleted
    ? [
        {
          id: 'restore',
          action: 'restore',
          primary: true,
          busy: restorePending,
          // Stiker jenis sistem dipulihkan lewat induknya (Desain QR/Postel), bukan di sini.
          hidden: !(canManage && systemKind === '' && onRestore),
          onSelect: () => onRestore?.(),
        },
      ]
    : [
        {
          id: 'edit',
          action: 'edit',
          label: 'Ubah',
          primary: true,
          hidden: !(canEdit && onEdit),
          onSelect: () => onEdit?.(),
        },
        ...(stockEntry ? [stockEntry] : []),
        {
          id: 'status',
          action: sticker.status === 'inactive' ? 'activate' : 'deactivate',
          primary: true,
          busy: statusPending,
          hidden: !(canManage && canToggle && onToggleStatus),
          onSelect: () => onToggleStatus?.(),
        },
        {
          id: 'delete',
          action: 'delete',
          hidden: !(canManage && sticker.status !== 'active' && systemKind === '' && onDelete),
          onSelect: () => onDelete?.(),
        },
      ];

  const detail = (
    <div className="space-y-6">
      <ViewSection title="Identitas">
        <DetailList
          items={[
            {
              label: 'Jenis',
              value: (
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  {sticker.typeDeleted && !canManage ? (
                    // Jenis terhapus hanya dapat dibuka pemulih; selain itu nama + penanda tanpa tautan.
                    <span>{sticker.typeName}</span>
                  ) : (
                    <Link
                      to="/sticker/types/$typeId"
                      params={{ typeId: sticker.typeId }}
                      className={textLink}
                    >
                      {sticker.typeName}
                    </Link>
                  )}
                  {sticker.typeDeleted ? <DeletedBadge /> : null}
                </span>
              ),
            },
            { label: 'Nama asli', value: sticker.name },
            { label: 'Alias', value: sticker.alias },
            {
              label: 'BU',
              value:
                buItems.length === 0 ? null : (
                  <span className="flex flex-wrap gap-2">
                    {buItems.map((bu) =>
                      canOpenBusinessUnit ? (
                        <Link
                          key={bu.id}
                          to="/access/business-units/$businessUnitId"
                          params={{ businessUnitId: bu.id }}
                          title={bu.name}
                          className={textLink}
                        >
                          {formatBuLabel(bu)}
                        </Link>
                      ) : (
                        <Badge key={bu.id} variant="outline" color="primary" title={bu.name}>
                          {formatBuLabel(bu)}
                        </Badge>
                      ),
                    )}
                  </span>
                ),
            },
            { label: 'Batas minimum', value: sticker.minQty },
            {
              label: 'Gambar contoh',
              value: sticker.fileId ? (
                <ImageThumb id={sticker.fileId} alt={`Contoh ${label}`} className="size-24" />
              ) : null,
            },
            {
              label: 'Status',
              value: (
                <ActiveStatusBadge
                  status={sticker.status}
                  label={STICKER_STATUS_LABEL[sticker.status]}
                />
              ),
            },
            { label: 'Asal', value: SYSTEM_ORIGIN[systemKind], hidden: systemKind === '' },
            {
              label: 'Sumber',
              value: sourceLink ? (
                <Link to={sourceLink.href as never} className={textLink}>
                  {sourceLink.label}
                </Link>
              ) : null,
              hidden: sourceLink === null,
            },
          ]}
        />
      </ViewSection>
    </div>
  );

  const tabs: ViewTab[] = [{ id: 'detail', label: 'Detail', content: detail }];
  if (showStock && stock) {
    const locationNames = new Map(stock.locations.map((location) => [location.id, location.name]));
    tabs.push(
      {
        id: 'stok',
        label: 'Stok',
        content: (
          <div className="space-y-6">
            <ViewSection title="Stok">
              <DetailList
                items={[
                  {
                    label: 'Total',
                    value: (
                      <span
                        className={
                          stockRow && stockRow.total < 0 ? 'text-destructive-text' : undefined
                        }
                      >
                        {formatStockQty(stockRow?.total ?? 0)}
                      </span>
                    ),
                  },
                  ...stock.locations.map((location) => ({
                    label: locationNames.get(location.id) ?? location.id,
                    value: formatStockQty(
                      stockRow?.byLocation.find((entry) => entry.locationId === location.id)?.qty ??
                        0,
                    ),
                  })),
                ]}
              />
            </ViewSection>
          </div>
        ),
      },
      {
        id: 'riwayat',
        label: 'Riwayat',
        content: (
          <StockHistoryPanel
            stickerId={sticker.id}
            locationIds={stock.locations.map((location) => location.id)}
            locationNames={locationNames}
          />
        ),
      },
    );
  }

  return (
    <>
      <ViewPage
        title={label}
        badge={
          <span className="flex flex-wrap items-center gap-2">
            {deleted ? (
              <DeletedBadge />
            ) : (
              <ActiveStatusBadge
                status={sticker.status}
                label={STICKER_STATUS_LABEL[sticker.status]}
              />
            )}
            {sticker.low && !deleted ? (
              <Badge color="warning" variant="soft">
                Menipis
              </Badge>
            ) : null}
          </span>
        }
        actionItems={actionItems}
        banner={
          sticker.deleted ? (
            <DeletedBanner
              info={sticker.deleted}
              canRestore={canManage && systemKind === ''}
              {...(onRestore ? { onRestore } : {})}
              restoring={restorePending}
            />
          ) : null
        }
        aside={
          <>
            <ViewMeta updatedAt={sticker.updatedAt} />
            <ActivityLog kind="sticker" id={sticker.id} />
          </>
        }
        tabs={tabs}
        {...(tab ? { tab } : {})}
        onTabChange={(id) => onTabChange?.(id as StickerTab)}
      />
      {stockActions?.dialogs}
    </>
  );
}
