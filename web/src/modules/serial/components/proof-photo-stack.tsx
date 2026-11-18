import { LoaderCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ProofPhotoRef } from '../lib/proof-source';

/** Lapisan di belakang foto terakhir: geser dan miring sedikit supaya terbaca sebagai tumpukan. */
const BACK_LAYERS = [
  'translate-x-1 -translate-y-1 rotate-6',
  'translate-x-2 -translate-y-2 rotate-12',
] as const;

export interface ProofPhotoStackProps {
  photos: ProofPhotoRef[];
  /** Foto yang sedang diunggah: indikator kecil berputar di sudut tumpukan. */
  uploading?: number;
  /** Daftar (strip) sedang terbuka: memengaruhi label dan `aria-expanded`. */
  expanded: boolean;
  onToggle(): void;
  /** Id elemen daftar foto yang dikendalikan (hanya dirujuk saat daftar tampil). */
  controls?: string;
}

/**
 * Thumbnail TUMPUKAN di samping rana (gaya galeri kamera ponsel): foto terakhir di depan, sampai dua lapis di
 * belakangnya, dan lencana jumlah foto. Mengetuknya membuka/menutup daftar foto (`ProofPhotoGrid` varian `strip`).
 * Tanpa foto, tidak tampil apa pun kecuali penanda unggah bila ada foto pertama yang sedang naik.
 */
export function ProofPhotoStack({
  photos,
  uploading = 0,
  expanded,
  onToggle,
  controls,
}: ProofPhotoStackProps) {
  if (photos.length === 0) {
    return uploading > 0 ? (
      <div
        data-testid="proof-photo-stack-uploading"
        className="flex size-14 items-center justify-center rounded-lg border-2 border-white/60 bg-black/50 text-white"
      >
        <LoaderCircle aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />
        <span className="sr-only">Mengunggah foto</span>
      </div>
    ) : null;
  }
  const front = photos[photos.length - 1] as ProofPhotoRef;
  const behind = photos.slice(-1 - BACK_LAYERS.length, -1).reverse();
  const label = `${expanded ? 'Sembunyikan' : 'Tampilkan'} daftar foto (${photos.length})`;
  return (
    <button
      type="button"
      data-testid="proof-photo-stack"
      aria-label={label}
      title={label}
      aria-expanded={expanded}
      aria-controls={expanded ? controls : undefined}
      className="relative block size-14 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/60"
      onClick={onToggle}
    >
      {behind.map((photo, index) => (
        <img
          key={photo.id}
          src={photo.thumbUrl}
          alt=""
          aria-hidden
          draggable={false}
          className={cn(
            'absolute inset-0 size-14 rounded-lg border-2 border-white/80 object-cover opacity-90',
            BACK_LAYERS[index],
          )}
          style={{ zIndex: BACK_LAYERS.length - index - 1 }}
        />
      ))}
      <img
        src={front.thumbUrl}
        alt=""
        aria-hidden
        draggable={false}
        className="absolute inset-0 size-14 rounded-lg border-2 border-white object-cover"
        style={{ zIndex: BACK_LAYERS.length }}
      />
      <span
        aria-hidden
        data-testid="proof-photo-stack-count"
        className="absolute -top-2 -right-2 z-10 flex min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] leading-5 font-semibold text-primary-foreground ring-2 ring-black/60"
        style={{ zIndex: BACK_LAYERS.length + 1 }}
      >
        {photos.length}
      </span>
      {uploading > 0 ? (
        <span
          data-testid="proof-photo-stack-uploading"
          className="absolute -bottom-1.5 -left-1.5 flex size-5 items-center justify-center rounded-full bg-black/70 text-white"
          style={{ zIndex: BACK_LAYERS.length + 1 }}
        >
          <LoaderCircle aria-hidden className="size-3 animate-spin motion-reduce:animate-none" />
          <span className="sr-only">Mengunggah foto</span>
        </span>
      ) : null}
    </button>
  );
}
