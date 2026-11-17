import type { ItemDto, ItemPostelDto } from '@shared/contract';
import { firmwareOptionsFor } from '@shared/firmware';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MarkdownView } from '@/modules/markdown/markdown-view';
import { PostelConditionBadge } from '@/modules/postel/components/postel-condition-badge';
import { formatPostelDate } from '@/modules/postel/lib/condition';
import { STICKER_STATUS_LABEL } from '@/modules/sticker/lib/status';
import { ImageThumb } from './image-thumb';
import { NoManualBookNote } from './manual-book-note';
import { NoPostelNote } from './no-postel-note';
import { StickerInstructionsView } from './sticker-instructions-view';

export interface ItemDetailViewProps {
  item: ItemDto;
  canEdit: boolean;
  canManage: boolean;
  statusPending: boolean;
  /** Tautan ke konfigurasi QR Manual Book item ini; tidak diberikan bila user tak berhak membukanya. */
  openManualBookHref?: ((designId: string) => string | null) | undefined;
  /**
   * Postel item: `undefined` = user tak boleh melihat Postel (`sticker: view`; bagian disembunyikan, jangan disimpulkan
   * dari `null` karena server juga mengirim `null` bagi yang tak berhak), `null` = belum ada Postel.
   */
  postel?: ItemPostelDto | null | undefined;
  /** Tautan ke halaman Postel; tidak diberikan/`null` bila user tak berhak membukanya. */
  openPostelHref?: ((postelId: string) => string | null) | undefined;
  onBack: () => void;
  onEdit: () => void;
  onToggleStatus: () => void;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** Halaman baca-saja item; QC memakainya sebagai acuan kerja (instruksi stiker, kelengkapan, spesifikasi). */
export function ItemDetailView({
  item,
  canEdit,
  canManage,
  statusPending,
  openManualBookHref,
  postel,
  openPostelHref,
  onBack,
  onEdit,
  onToggleStatus,
}: ItemDetailViewProps) {
  const postelHref = postel ? (openPostelHref?.(postel.id) ?? null) : null;
  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">
            {item.brand} {item.model}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            {item.isCountryLock ? <Badge variant="outline">Country lock</Badge> : null}
            {item.firmware !== '' ? (
              <Badge variant="outline">
                Firmware:{' '}
                {firmwareOptionsFor(item.brand).find((o) => o.code === item.firmware)?.label ??
                  item.firmware}
              </Badge>
            ) : null}
            {item.status === 'inactive' ? <Badge variant="secondary">Nonaktif</Badge> : null}
            {item.businessUnits.map((bu) => (
              <Badge key={bu.id} variant="outline" title={bu.name}>
                {bu.code}
              </Badge>
            ))}
          </div>
          {item.aliases.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              <span className="sr-only">Nama lain: </span>
              {item.aliases.join(', ')}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onBack}>
            Kembali ke daftar
          </Button>
          {canEdit ? <Button onClick={onEdit}>Ubah</Button> : null}
          {canManage ? (
            <Button variant="ghost" disabled={statusPending} onClick={onToggleStatus}>
              {item.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'}
            </Button>
          ) : null}
        </div>
      </div>

      <Section title="Gambar lampiran">
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
      </Section>

      <Section title="Manual Book">
        {item.manualBook === null ? (
          <NoManualBookNote className="text-sm" />
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{item.manualBook.name}</span>
            <Badge variant="outline">{`v${item.manualBook.version}`}</Badge>
            <Badge variant={item.manualBook.status === 'active' ? 'default' : 'secondary'}>
              {STICKER_STATUS_LABEL[item.manualBook.status]}
            </Badge>
            {openManualBookHref?.(item.manualBook.designId) ? (
              <a
                href={openManualBookHref(item.manualBook.designId) ?? undefined}
                className="underline underline-offset-2"
              >
                Buka konfigurasi QR
              </a>
            ) : null}
          </div>
        )}
      </Section>

      {postel === undefined ? (
        // Tanpa `sticker: view` ringkasan Postel disembunyikan (spek 4b butir 10), tetapi keterangan "Belum ada
        // Postel" tampil bagi semua pembaca item seperti Manual Book (keputusan pemilik 2026-11-12).
        item.hasPostel ? null : (
          <Section title="Postel">
            <NoPostelNote className="text-sm" />
          </Section>
        )
      ) : (
        <Section title="Postel">
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
                <a href={postelHref} className="underline underline-offset-2">
                  Buka Postel
                </a>
              ) : null}
            </div>
          )}
        </Section>
      )}

      <Section title="Instruksi stiker">
        <StickerInstructionsView
          photos={item.stickerPhotos}
          canEdit={canEdit}
          editHref={`/item/${encodeURIComponent(item.id)}/edit`}
          onEdit={onEdit}
          buLabels={Object.fromEntries(item.businessUnits.map((bu) => [bu.id, bu.code]))}
          multiBu={item.businessUnits.length > 1}
        />
      </Section>

      <Section title="Kelengkapan aksesoris">
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
      </Section>

      <Section title="Detail dan spesifikasi">
        {item.detail.trim() === '' ? (
          <p className="text-sm text-muted-foreground">Belum ada detail.</p>
        ) : (
          <MarkdownView source={item.detail} />
        )}
      </Section>
    </div>
  );
}
