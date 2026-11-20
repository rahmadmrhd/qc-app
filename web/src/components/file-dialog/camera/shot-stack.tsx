import { cn } from '@/lib/utils';
import type { CameraShot } from './camera-dialog';

/** Lapisan di belakang foto terakhir: geser dan miring sedikit supaya terbaca sebagai tumpukan. */
const BACK_LAYERS = [
  'translate-x-1 -translate-y-1 rotate-6',
  'translate-x-2 -translate-y-2 rotate-12',
] as const;

export interface ShotStackProps {
  shots: readonly CameraShot[];
  /** Daftar (strip) sedang terbuka: memengaruhi label dan `aria-expanded`. */
  expanded: boolean;
  onToggle(): void;
  /** Id elemen daftar foto yang dikendalikan (hanya dirujuk saat daftar tampil). */
  controls?: string;
}

/**
 * Thumbnail TUMPUKAN di samping rana (gaya galeri kamera ponsel): foto terakhir di depan, sampai dua lapis di
 * belakangnya, dan lencana jumlah foto. Mengetuknya membuka/menutup daftar foto (`ShotStrip`). Tanpa foto, tidak tampil.
 */
export function ShotStack({ shots, expanded, onToggle, controls }: ShotStackProps) {
  if (shots.length === 0) return null;
  const front = shots[shots.length - 1] as CameraShot;
  const behind = shots.slice(-1 - BACK_LAYERS.length, -1).reverse();
  const label = `${expanded ? 'Sembunyikan' : 'Tampilkan'} daftar foto (${shots.length})`;
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
      {behind.map((shot, index) => (
        <img
          key={shot.key}
          src={shot.url}
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
        src={front.url}
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
        {shots.length}
      </span>
    </button>
  );
}
