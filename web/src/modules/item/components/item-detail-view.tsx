import type { ItemDto } from '@shared/contract';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MarkdownView } from '@/modules/markdown/markdown-view';
import { ImageThumb } from './image-thumb';

export interface ItemDetailViewProps {
  item: ItemDto;
  canEdit: boolean;
  canManage: boolean;
  statusPending: boolean;
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

/** Halaman baca-saja item; QC memakainya sebagai acuan kerja (stiker, kelengkapan, spesifikasi). */
export function ItemDetailView({
  item,
  canEdit,
  canManage,
  statusPending,
  onBack,
  onEdit,
  onToggleStatus,
}: ItemDetailViewProps) {
  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">
            {item.brand} {item.model}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            {item.isCountryLock ? <Badge variant="outline">Country lock</Badge> : null}
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

      <Section title="Stiker yang perlu ditempel">
        {item.stickers.length === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada stiker.</p>
        ) : (
          <ul className="space-y-3">
            {item.stickers.map((sticker, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: nama stiker boleh sama; urutan tetap
              <li key={index} className="flex items-start gap-3">
                {sticker.fileId ? (
                  <ImageThumb
                    id={sticker.fileId}
                    alt={`Contoh ${sticker.name}`}
                    className="size-16 shrink-0"
                  />
                ) : null}
                <div>
                  <div className="font-medium">{sticker.name}</div>
                  {sticker.note ? (
                    <div className="text-sm text-muted-foreground">{sticker.note}</div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
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
