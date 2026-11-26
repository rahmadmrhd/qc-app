import { formatBuLabel } from '@shared/business-units';
import type { BusinessUnitOptionDto, QrDesignDto, QrPresetDto } from '@shared/contract';
import type { QrFrame } from '@shared/qrcode';
import { LinkCell } from '@/components/data-table';
import { PageContent } from '@/components/page/page-container';
import { DetailList, ViewMeta, ViewPage, ViewSection } from '@/components/page/view-page';
import { DeletedBadge } from '@/components/soft-delete/deleted-badge';
import { DeletedBanner } from '@/components/soft-delete/deleted-banner';
import { Button } from '@/components/ui/button';
import { ActivityLog } from '@/modules/activity/components/activity-log';
import { useFileUrl } from '@/modules/files/queries';
import { LabelPreview } from './label-preview';

export const QR_PRESET_VIEW_TABS = ['detail', 'dipakai'] as const;
export type QrPresetViewTab = (typeof QR_PRESET_VIEW_TABS)[number];

/** Tautan contoh pada pratinjau: preset tidak punya sumber link, QR pada pratinjau hanya ilustrasi. */
const PREVIEW_LINK = 'https://contoh.com';

const FRAME_KIND_LABEL: Record<QrFrame['kind'], string> = {
  none: 'Tanpa bingkai',
  corners: 'Siku di sudut',
  box: 'Kotak penuh',
};
const FRAME_LINE_LABEL: Record<QrFrame['line'], string> = {
  solid: 'garis penuh',
  dashed: 'garis putus-putus',
  dotted: 'garis titik-titik',
};

/** Ringkasan bingkai preset untuk tab Detail (selain pratinjau). */
function frameSummary(frame: QrFrame): string {
  if (frame.kind === 'none') return FRAME_KIND_LABEL.none;
  return `${FRAME_KIND_LABEL[frame.kind]}, ${FRAME_LINE_LABEL[frame.line]}, tebal ${frame.thickness} mm`;
}

export interface QrPresetViewProps {
  /** `undefined` = konfigurasi default tidak ada (id salah, atau terhapus bagi yang tak boleh melihatnya). */
  preset: QrPresetDto | undefined;
  businessUnits: readonly BusinessUnitOptionDto[];
  /** Konfigurasi QR hidup yang memakai preset ini (dari daftar `qrcodes.list`); `undefined` = belum termuat. */
  usedBy: readonly QrDesignDto[] | undefined;
  /** Nama BU menaut ke halaman BU hanya bila pengguna berhak. */
  canOpenBusinessUnit?: boolean;
  /** Nama konfigurasi QR menaut ke View-nya (`qrcode: view`). */
  canOpenDesign?: boolean;
  restorePending?: boolean;
  tab?: QrPresetViewTab | undefined;
  onTabChange?: (tab: QrPresetViewTab) => void;
  onBack: () => void;
  onEdit?: () => void;
  onClone?: () => void;
  onDelete?: () => void;
  onRestore?: () => void;
}

function PresetPreview({ preset }: { preset: QrPresetDto }) {
  const { url } = useFileUrl(preset.defaultLogoId);
  return (
    <LabelPreview
      title={preset.title}
      subtitle={preset.subtitle}
      footer={preset.footer}
      link={PREVIEW_LINK}
      layout={preset.layout}
      style={preset.style}
      logoUrl={preset.defaultLogoId !== '' ? url : null}
    />
  );
}

const nameOf = (design: QrDesignDto) => (design.name !== '' ? design.name : design.title);

/** Halaman baca satu konfigurasi default QR: tab Detail dan "Dipakai oleh" (konfigurasi QR yang memakainya). */
export function QrPresetView({
  preset,
  businessUnits,
  usedBy,
  canOpenBusinessUnit = false,
  canOpenDesign = false,
  restorePending = false,
  tab,
  onTabChange,
  onBack,
  onEdit,
  onClone,
  onDelete,
  onRestore,
}: QrPresetViewProps) {
  if (!preset) {
    return (
      <PageContent className="space-y-4">
        <h1 className="text-2xl font-semibold">Konfigurasi default tidak ditemukan</h1>
        <Button variant="outline" color="primary" onClick={onBack}>
          Kembali ke daftar
        </Button>
      </PageContent>
    );
  }
  const deleted = preset.deleted !== undefined;
  const unit = businessUnits.find((entry) => entry.id === preset.buId);

  const detail = (
    <div className="space-y-6">
      <ViewSection title="Identitas">
        <DetailList
          items={[
            {
              label: 'Business Unit',
              value:
                preset.buId === '' ? (
                  'Belum diatur'
                ) : unit ? (
                  canOpenBusinessUnit ? (
                    <LinkCell
                      to="/access/business-units/$businessUnitId"
                      params={{ businessUnitId: unit.id }}
                    >
                      {formatBuLabel(unit)}
                    </LinkCell>
                  ) : (
                    formatBuLabel(unit)
                  )
                ) : null,
            },
            {
              label: 'Nama Manual Book di',
              value:
                preset.namePlacement === '' ? null : (
                  <span className="capitalize">{preset.namePlacement}</span>
                ),
            },
            { label: 'Title', value: preset.title },
            { label: 'Subtitle', value: preset.subtitle },
            { label: 'Footer', value: preset.footer },
            {
              label: 'Logo awal',
              value: preset.defaultLogoId === '' ? 'Tanpa logo' : 'Ada logo awal',
            },
            { label: 'Ukuran QR', value: `${preset.layout.qrSize} mm` },
            {
              label: 'Ukuran huruf',
              value: `Title ${preset.layout.titleSize} pt, Subtitle ${preset.layout.subtitleSize} pt, Footer ${preset.layout.footerSize} pt`,
            },
            { label: 'Luas logo', value: `${preset.layout.logoArea}% luas QR` },
            { label: 'Bingkai', value: frameSummary(preset.style.frame) },
          ]}
        />
      </ViewSection>
      <ViewSection title="Pratinjau label">
        <PresetPreview preset={preset} />
      </ViewSection>
    </div>
  );

  const used = (
    <ViewSection title="Dipakai oleh">
      {usedBy === undefined ? (
        <p className="text-sm text-muted-foreground">Memuat…</p>
      ) : usedBy.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Belum ada konfigurasi QR yang dibuat dari konfigurasi default ini.
        </p>
      ) : (
        <ul className="space-y-1 text-sm">
          {usedBy.map((design) => (
            <li key={design.id}>
              {canOpenDesign ? (
                <LinkCell to="/qrcode/$designId" params={{ designId: design.id }}>
                  {nameOf(design)}
                </LinkCell>
              ) : (
                nameOf(design)
              )}
            </li>
          ))}
        </ul>
      )}
    </ViewSection>
  );

  return (
    <ViewPage
      title={preset.name}
      badge={deleted ? <DeletedBadge /> : null}
      tab={tab ?? 'detail'}
      onTabChange={(id) => onTabChange?.(id as QrPresetViewTab)}
      tabs={[
        { id: 'detail', label: 'Detail', content: detail },
        { id: 'dipakai', label: 'Dipakai oleh', content: used },
      ]}
      actionItems={
        deleted
          ? [
              {
                id: 'restore',
                action: 'restore',
                primary: true,
                busy: restorePending,
                hidden: !onRestore,
                onSelect: () => onRestore?.(),
              },
            ]
          : [
              {
                id: 'edit',
                action: 'edit',
                label: 'Ubah',
                primary: true,
                hidden: !onEdit,
                onSelect: () => onEdit?.(),
              },
              {
                id: 'clone',
                action: 'copy',
                label: 'Kloning ke BU lain',
                hidden: !onClone,
                onSelect: () => onClone?.(),
              },
              { id: 'delete', action: 'delete', hidden: !onDelete, onSelect: () => onDelete?.() },
            ]
      }
      banner={
        preset.deleted ? (
          <DeletedBanner
            info={preset.deleted}
            canRestore
            {...(onRestore ? { onRestore } : {})}
            restoring={restorePending}
          />
        ) : null
      }
      aside={
        <>
          <ViewMeta
            createdBy={preset.createdBy}
            createdAt={preset.createdAt}
            updatedBy={preset.updatedBy}
            updatedAt={preset.updatedAt}
          />
          <ActivityLog kind="qrPreset" id={preset.id} createdAt={preset.createdAt} />
        </>
      }
    />
  );
}
