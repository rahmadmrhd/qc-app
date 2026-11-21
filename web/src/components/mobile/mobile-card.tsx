import { cn } from 'cn';
import type { HTMLAttributes, ReactNode } from 'react';

export interface MobileCardMeta {
  /** Kunci unik baris meta (mis. id kolom). */
  id: string;
  label: ReactNode;
  value: ReactNode;
}

/**
 * Anatomi kartu tunggal ponsel (spek redesain §6.12, butir 39). Dipakai `DataTable` mode kartu (`DataCards`), kartu
 * draft Serial, dan kartu `GridView` yang butuh judul: tata letaknya sama di semua halaman.
 *
 * ```
 * [leading]  Judul / tautan                [actions ⋯]
 *            Subjudul
 *            [badge] [badge]
 *            Label  Nilai
 *            Label  Nilai
 *            {footer}
 * ```
 * `leading` = kotak centang mode pilih; `media` = gambar mini di kiri; `actions` = menu aksi (satu tombol ⋯).
 * Tidak memuat logika: pilihan, tekan lama, dan menu disediakan pemanggil lewat `rootProps` dan slot.
 */
export function MobileCard({
  title,
  subtitle,
  badges,
  meta,
  leading,
  media,
  actions,
  footer,
  selected = false,
  tone,
  className,
  rootProps,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  badges?: readonly ReactNode[];
  meta?: readonly MobileCardMeta[];
  leading?: ReactNode;
  media?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  selected?: boolean;
  /** Warna bingkai untuk kartu yang perlu perhatian (galat/peringatan). */
  tone?: 'error' | 'warn';
  className?: string;
  /** Atribut `<li>` akar (pengikat tekan lama, `data-*`). */
  rootProps?: HTMLAttributes<HTMLLIElement> & Record<`data-${string}`, string | undefined>;
}) {
  const visibleBadges = badges?.filter((badge) => badge !== null && badge !== false) ?? [];
  return (
    <li
      data-slot="mobile-card"
      data-state={selected ? 'selected' : undefined}
      {...rootProps}
      className={cn(
        'rounded-lg border bg-card p-3 data-[state=selected]:bg-info-text/8',
        tone === 'error' && 'border-destructive/40 bg-destructive/5',
        tone === 'warn' && 'border-warning-text/35 bg-warning-text/5',
        rootProps?.className,
        className,
      )}
    >
      <div className="flex items-start gap-3">
        {leading ? (
          <div className="flex min-h-6 shrink-0 items-center pt-0.5">{leading}</div>
        ) : null}
        {media ? <div className="shrink-0">{media}</div> : null}
        <div className="min-w-0 flex-1 space-y-0.5 break-words">
          <div className="text-base">{title}</div>
          {subtitle ? <div className="text-sm text-muted-foreground">{subtitle}</div> : null}
        </div>
        {actions ? <div className="-mt-2.5 -mr-2 shrink-0">{actions}</div> : null}
      </div>
      {visibleBadges.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {visibleBadges.map((badge, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: lencana tak berurutan dan tak berubah posisi
            <span key={index}>{badge}</span>
          ))}
        </div>
      ) : null}
      {meta && meta.length > 0 ? (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          {meta.map((entry) => (
            <div key={entry.id} className="contents">
              <dt className="text-muted-foreground">{entry.label}</dt>
              <dd className="min-w-0 break-words">{entry.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {footer ? <div className="mt-2">{footer}</div> : null}
    </li>
  );
}
