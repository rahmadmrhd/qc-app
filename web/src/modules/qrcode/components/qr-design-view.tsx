import type { QrDesignDto, QrFileKind } from '@shared/contract';
import { LinkCell } from '@/components/data-table';
import { DetailList, ViewMeta, ViewPage, ViewSection } from '@/components/page/view-page';
import { DeletedBadge } from '@/components/soft-delete/deleted-badge';
import { DeletedBanner } from '@/components/soft-delete/deleted-banner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatStamp } from '@/lib/format-stamp';
import { isWebUrl } from '@/lib/web-url';
import { useFileUrl } from '@/modules/files/queries';
import { STICKER_STATUS_LABEL } from '@/modules/sticker/lib/status';
import { LabelPreview } from './label-preview';
import { VersionHistory } from './version-history';

export const QR_VIEW_TABS = ['detail', 'item', 'versi'] as const;
export type QrViewTab = (typeof QR_VIEW_TABS)[number];

export interface QrDesignViewProps {
  /** `undefined` = konfigurasi tidak ada (id salah, atau terhapus bagi yang tak boleh melihatnya). */
  design: QrDesignDto | undefined;
  /** Nama konfigurasi default asal (dari `qrcodes.getPreset`); kosong = tak diketahui/tanpa preset. */
  presetName?: string | undefined;
  /** Nama konfigurasi default menaut ke View-nya hanya bila pengguna berhak (`qrPresetLinkAccess`). */
  canOpenPreset?: boolean;
  /**
   * BU konfigurasi default asal (dari data preset yang sudah dimuat): konfigurasi QR tidak menyimpan BU sendiri, jadi
   * tampil sebagai "Mengikuti preset" (keputusan pemilik 2026-11-21).
   */
  presetBusinessUnit?: { name: string; code: string } | undefined;
  canEdit?: boolean;
  canManage?: boolean;
  /** Nama item menaut ke View item hanya bila pengguna berhak. */
  canOpenItem?: boolean;
  /** Item terhapus hanya menaut ke View bagi pemegang izin Pulihkan item. */
  canOpenDeletedItem?: boolean;
  /** Gambar contoh pada riwayat versi hanya bagi yang boleh membaca berkas stiker. */
  canViewImages?: boolean;
  /** Unduhan sedang berjalan (tombol Unduh dinonaktifkan). */
  downloadBusy?: boolean;
  restorePending?: boolean;
  tab?: QrViewTab | undefined;
  onTabChange?: (tab: QrViewTab) => void;
  onBack: () => void;
  onEdit?: () => void;
  onExport?: () => void;
  onDownload?: (kind: QrFileKind) => void;
  onDelete?: () => void;
  onRestore?: () => void;
}

const nameOf = (design: QrDesignDto) => (design.name !== '' ? design.name : design.title);

/** Pratinjau label 3 × 3 cm hanya-baca (logo dimuat lewat `files.get`). */
function ReadOnlyPreview({ design }: { design: QrDesignDto }) {
  const { url } = useFileUrl(design.logoFileId);
  return (
    <LabelPreview
      title={design.title}
      subtitle={design.subtitle}
      footer={design.footer}
      link={design.link}
      layout={design.layout}
      style={design.style}
      logoUrl={design.logoFileId !== '' ? url : null}
    />
  );
}

function ExportBadge({ design }: { design: QrDesignDto }) {
  if (design.exportStatus === 'none') return <Badge variant="secondary">Belum diekspor</Badge>;
  return (
    <Badge variant={design.exportStatus === 'stale' ? 'outline' : 'default'}>
      {design.exportStatus === 'stale' ? 'Berubah sejak ekspor' : 'Sudah diekspor'}
    </Badge>
  );
}

/** Halaman baca satu konfigurasi QR: tab Detail (label dan sumber), Item, dan Versi stiker. */
export function QrDesignView({
  design,
  presetName,
  canOpenPreset = false,
  presetBusinessUnit,
  canEdit = false,
  canManage = false,
  canOpenItem = true,
  canOpenDeletedItem = true,
  canViewImages = false,
  downloadBusy = false,
  restorePending = false,
  tab,
  onTabChange,
  onBack,
  onEdit,
  onExport,
  onDownload,
  onDelete,
  onRestore,
}: QrDesignViewProps) {
  if (!design) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Konfigurasi tidak ditemukan</h1>
        <Button variant="outline" onClick={onBack}>
          Kembali ke daftar
        </Button>
      </div>
    );
  }
  const deleted = design.deleted !== undefined;
  const exported = design.exportedAt !== '';
  const totalItems = design.items.length + design.hiddenItemCount;

  const detail = (
    <div className="space-y-6">
      {design.overflow ? (
        <Alert color="destructive">
          <AlertDescription>
            Isi label tidak muat di kanvas 3 × 3 cm. Ubah konfigurasi lalu simpan ulang sebelum
            diekspor.
          </AlertDescription>
        </Alert>
      ) : null}
      <ViewSection title="Identitas">
        <DetailList
          items={[
            { label: 'Nama Manual Book', value: design.name },
            { label: 'Title', value: design.title },
            { label: 'Subtitle', value: design.subtitle },
            { label: 'Footer', value: design.footer },
            {
              label: 'Konfigurasi default',
              value:
                design.presetId === '' ? null : (
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    {canOpenPreset ? (
                      <LinkCell
                        to="/qrcode/default/$presetId"
                        params={{ presetId: design.presetId }}
                      >
                        {presetName ?? 'Konfigurasi default'}
                      </LinkCell>
                    ) : (
                      (presetName ?? 'Konfigurasi default')
                    )}
                    {design.presetDeleted ? <DeletedBadge /> : null}
                  </span>
                ),
            },
            {
              label: 'Business Unit',
              value: presetBusinessUnit
                ? `Mengikuti preset: ${presetBusinessUnit.name} (${presetBusinessUnit.code})`
                : null,
              hidden: presetBusinessUnit === undefined,
            },
            {
              label: 'Versi stiker',
              value:
                design.stickerVersion === 0 || design.stickerStatus === '' ? null : (
                  <span className="inline-flex items-center gap-1.5">
                    {`v${design.stickerVersion}`}
                    {design.stickerStatus === 'active' ? null : (
                      <Badge variant="outline">{STICKER_STATUS_LABEL[design.stickerStatus]}</Badge>
                    )}
                  </span>
                ),
            },
          ]}
        />
      </ViewSection>
      <ViewSection title="Sumber link">
        <DetailList
          items={[
            { label: 'Jenis', value: design.linkSource === 'pdf' ? 'PDF di Drive' : 'URL' },
            { label: 'Nama berkas', value: design.linkSource === 'pdf' ? design.documentName : '' },
            {
              label: 'Link',
              value: isWebUrl(design.link) ? (
                <a
                  href={design.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all text-info-text underline-offset-4 hover:underline"
                >
                  {design.link}
                </a>
              ) : (
                <span className="break-all">{design.link}</span>
              ),
            },
            {
              label: 'Ekspor terakhir',
              value: exported ? `${formatStamp(design.exportedAt)} · ${design.exportedBy}` : null,
            },
          ]}
        />
      </ViewSection>
      <ViewSection title="Pratinjau label">
        <ReadOnlyPreview design={design} />
      </ViewSection>
    </div>
  );

  const itemsTab = (
    <ViewSection title="Item tergabung">
      {design.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {totalItems === 0
            ? 'Belum ada item yang tergabung.'
            : 'Tidak ada item yang dapat Anda lihat.'}
        </p>
      ) : (
        <ul className="space-y-1 text-sm">
          {design.items.map((item) => {
            const label = `${item.brand} ${item.model}`;
            const linked = canOpenItem && (!item.deleted || canOpenDeletedItem);
            return (
              <li key={item.id} className="flex flex-wrap items-center gap-1.5">
                {linked ? (
                  <LinkCell to="/item/$itemId" params={{ itemId: item.id }}>
                    {label}
                  </LinkCell>
                ) : (
                  <span>{label}</span>
                )}
                {item.deleted ? <DeletedBadge /> : null}
              </li>
            );
          })}
        </ul>
      )}
      {design.hiddenItemCount > 0 ? (
        <p className="text-sm text-muted-foreground">
          {`${design.hiddenItemCount} item lain tergabung di sini tetapi tidak terlihat oleh Anda`}
        </p>
      ) : null}
    </ViewSection>
  );

  return (
    <ViewPage
      title={nameOf(design)}
      badge={deleted ? <DeletedBadge /> : <ExportBadge design={design} />}
      tab={tab ?? 'detail'}
      onTabChange={(id) => onTabChange?.(id as QrViewTab)}
      tabs={[
        { id: 'detail', label: 'Detail', content: detail },
        { id: 'item', label: 'Item', content: itemsTab },
        {
          id: 'versi',
          label: 'Versi stiker',
          content: <VersionHistory designId={design.id} canViewImages={canViewImages} />,
        },
      ]}
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
                id: 'export',
                action: 'export',
                label: exported ? 'Ekspor ulang' : 'Ekspor',
                hidden: !(canEdit && onExport),
                disabled: design.overflow,
                onSelect: () => onExport?.(),
              },
              {
                id: 'download-pdf',
                action: 'download',
                label: 'Unduh PDF',
                hidden: !(exported && onDownload),
                disabled: downloadBusy,
                onSelect: () => onDownload?.('pdf'),
              },
              {
                id: 'download-png',
                action: 'download',
                label: 'Unduh PNG',
                hidden: !(exported && onDownload),
                disabled: downloadBusy,
                onSelect: () => onDownload?.('png'),
              },
              {
                id: 'delete',
                action: 'delete',
                hidden: !(canManage && onDelete),
                onSelect: () => onDelete?.(),
              },
            ]
      }
      banner={
        design.deleted ? (
          <DeletedBanner
            info={design.deleted}
            canRestore={canManage}
            {...(onRestore ? { onRestore } : {})}
            restoring={restorePending}
          />
        ) : null
      }
      aside={
        <ViewMeta
          createdBy={design.createdBy}
          createdAt={design.createdAt}
          updatedBy={design.updatedBy}
          updatedAt={design.updatedAt}
        />
      }
    />
  );
}
