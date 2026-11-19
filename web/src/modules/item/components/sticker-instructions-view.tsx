import type { ItemStickerPhotoDto } from '@shared/contract';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { guidePreviewUrl } from '@/modules/sticker/lib/guide-source';
import { ImageThumb } from './image-thumb';

export interface StickerInstructionsViewProps {
  photos: readonly ItemStickerPhotoDto[];
  /** Boleh mengubah item: tanda "belum ada instruksi" menawarkan tautan ke form. */
  canEdit: boolean;
  editHref: string;
  /** Bila ada, klik tautan membuka form lewat navigasi aplikasi (tautan tetap berisi `editHref`). */
  onEdit?: () => void;
  /** Label lencana BU foto per id BU (mis. kode BU). Tanpa entri, lencana tidak tampil. */
  buLabels?: Readonly<Record<string, string>>;
  /** Item punya lebih dari satu BU: baris daftar menampilkan kode BU penyebab tiap stiker. */
  multiBu?: boolean;
  /**
   * Sumber gambar pengganti. Bawaan: foto lewat REST (butuh sesi). Katalog Tipe offline di desktop memberi alamat cache
   * lokal (`app://qc/catalog-files/<id>`) agar tampilan yang sama jalan tanpa login dan tanpa jaringan.
   */
  imageSource?: { guide(id: string): string; sticker(id: string): string };
}

/** Tanda kecil "belum ada instruksi stiker"; dipakai juga oleh tabel daftar item. */
export function NoInstructionsNote({ className }: { className?: string }) {
  return (
    <span className={cn('text-xs text-muted-foreground', className)}>
      Belum ada instruksi stiker
    </span>
  );
}

/** Bingkai foto; dimensi 0 (tak diketahui): rasio diukur dari gambar saat dimuat agar posisi penanda konsisten. */
function PhotoFrame({
  src,
  width,
  height,
  children,
}: {
  src: string;
  width: number;
  height: number;
  children: ReactNode;
}) {
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const known = width > 0 && height > 0 ? { width, height } : natural;
  return (
    <div
      className="relative w-full rounded-lg bg-muted"
      style={{ aspectRatio: known ? `${known.width} / ${known.height}` : '4 / 3' }}
    >
      <img
        src={src}
        alt=""
        className="absolute inset-0 size-full rounded-lg object-contain"
        onLoad={(event) => {
          const { naturalWidth, naturalHeight } = event.currentTarget;
          if (naturalWidth > 0 && naturalHeight > 0) {
            setNatural({ width: naturalWidth, height: naturalHeight });
          }
        }}
      />
      {children}
    </div>
  );
}

/**
 * Tampilan baca instruksi stiker: tiap foto dengan penanda bernomor (layar lebar: nama di samping nomor; ponsel: hanya
 * nomor) dan SELALU daftar di bawah foto (nomor, gambar contoh, nama, catatan, tanda nonaktif/peringatan). Mengetuk
 * penanda menyorot barisnya.
 */
export function StickerInstructionsView({
  photos,
  canEdit,
  editHref,
  onEdit,
  buLabels = {},
  multiBu = false,
  imageSource,
}: StickerInstructionsViewProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  // Penanda diketuk: gulirkan barisnya ke area terlihat (di ponsel daftar bisa panjang).
  useEffect(() => {
    if (selected !== null) rowRefs.current.get(selected)?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);
  const hasMarks = photos.some((photo) => photo.marks.length > 0);

  return (
    <div className="space-y-4">
      {hasMarks ? null : (
        <div className="flex flex-wrap items-center gap-2">
          <NoInstructionsNote className="text-sm" />
          {canEdit ? (
            <a
              href={editHref}
              className="text-sm underline underline-offset-2"
              onClick={(event) => {
                if (!onEdit) return;
                event.preventDefault();
                onEdit();
              }}
            >
              Tambahkan instruksi
            </a>
          ) : null}
        </div>
      )}
      {photos.map((photo, photoIndex) => {
        const number = photoIndex + 1;
        const buLabel = photo.buId ? buLabels[photo.buId] : undefined;
        return (
          <fieldset
            key={photo.guideId}
            aria-label={`Foto instruksi ${number}`}
            className="m-0 min-w-0 space-y-3 rounded-lg border p-3"
          >
            {photo.caption !== '' || buLabel ? (
              <div className="flex flex-wrap items-center gap-2">
                {photo.caption !== '' ? (
                  <p className="text-sm font-medium">{photo.caption}</p>
                ) : null}
                {buLabel ? (
                  <Badge variant="outline" title="Label BU foto">
                    {buLabel}
                  </Badge>
                ) : null}
              </div>
            ) : null}
            <PhotoFrame
              src={imageSource ? imageSource.guide(photo.guideId) : guidePreviewUrl(photo.guideId)}
              width={photo.width}
              height={photo.height}
            >
              {photo.marks.map((mark, markIndex) => {
                const key = `${photoIndex}:${markIndex}`;
                const isSelected = selected === key;
                return (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: penanda tak punya id; nomor = urutan
                    key={markIndex}
                    className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1"
                    style={{ left: `${mark.x / 10}%`, top: `${mark.y / 10}%` }}
                  >
                    <button
                      type="button"
                      aria-label={`Penanda ${markIndex + 1}`}
                      aria-pressed={isSelected}
                      className={cn(
                        'flex size-7 items-center justify-center rounded-full border-2 border-background bg-primary text-xs font-semibold text-primary-foreground shadow-md outline-none focus-visible:ring-3 focus-visible:ring-ring',
                        isSelected && 'ring-3 ring-ring',
                      )}
                      onClick={() => setSelected(isSelected ? null : key)}
                    >
                      {markIndex + 1}
                    </button>
                    <span
                      data-mark-label=""
                      className="pointer-events-none hidden max-w-40 truncate rounded bg-background/90 px-1.5 py-0.5 text-xs shadow sm:inline"
                    >
                      {mark.targetName}
                    </span>
                  </div>
                );
              })}
            </PhotoFrame>
            {photo.marks.length > 0 ? (
              <ol aria-label={`Penanda foto ${number}`} className="space-y-2">
                {photo.marks.map((mark, markIndex) => {
                  const key = `${photoIndex}:${markIndex}`;
                  return (
                    <li
                      // biome-ignore lint/suspicious/noArrayIndexKey: penanda tak punya id; nomor = urutan
                      key={markIndex}
                      ref={(node) => {
                        if (node) rowRefs.current.set(key, node);
                        else rowRefs.current.delete(key);
                      }}
                      data-mark={markIndex + 1}
                      data-selected={selected === key ? 'true' : undefined}
                      className="flex items-start gap-3 rounded-lg border p-2 data-[selected=true]:border-ring data-[selected=true]:ring-2 data-[selected=true]:ring-ring/50"
                    >
                      <span
                        aria-hidden
                        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
                      >
                        {markIndex + 1}
                      </span>
                      <div className="min-w-0 flex-1 space-y-2">
                        {mark.unresolved ? (
                          <p className="text-sm text-amber-600 dark:text-amber-400">
                            Belum ada stiker {mark.targetName} untuk BU ini
                          </p>
                        ) : null}
                        {mark.resolved.map((sticker) => (
                          <div key={sticker.id} className="flex items-start gap-3">
                            {sticker.fileId && imageSource ? (
                              <img
                                src={imageSource.sticker(sticker.fileId)}
                                alt={`Contoh ${sticker.name}`}
                                className="size-16 shrink-0 rounded-md border object-cover"
                              />
                            ) : sticker.fileId ? (
                              <ImageThumb
                                id={sticker.fileId}
                                alt={`Contoh ${sticker.name}`}
                                className="size-16 shrink-0"
                              />
                            ) : null}
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-medium">{sticker.name}</span>
                                {sticker.alias !== '' ? (
                                  <span className="text-sm text-muted-foreground">
                                    ({sticker.alias})
                                  </span>
                                ) : null}
                                {sticker.inactive ? (
                                  <Badge variant="secondary">nonaktif</Badge>
                                ) : null}
                                {multiBu
                                  ? sticker.buCodes.map((code) => (
                                      <Badge key={code} variant="outline">
                                        {code}
                                      </Badge>
                                    ))
                                  : null}
                              </div>
                            </div>
                          </div>
                        ))}
                        {mark.note !== '' ? (
                          <p className="text-sm text-muted-foreground">{mark.note}</p>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : null}
          </fieldset>
        );
      })}
    </div>
  );
}
