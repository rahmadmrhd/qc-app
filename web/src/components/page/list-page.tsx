import type { ReactNode } from 'react';
import { HeadroomBar, HeadroomFrame } from './headroom-bar';

/**
 * Kerangka halaman daftar (spek redesain 6.5): bar headroom (judul + aksi + filter), isi, lalu bar aksi massal
 * yang menempel di bawah layar.
 */
export function ListPage({
  title,
  actions,
  filters,
  bulkBar,
  children,
  tour,
  actionsTour,
  pinned,
}: {
  title: ReactNode;
  actions?: ReactNode;
  filters?: ReactNode;
  bulkBar?: ReactNode;
  children: ReactNode;
  /** `data-tour` pada bar judul. */
  tour?: string;
  /** `data-tour` pada pembungkus `actions`. */
  actionsTour?: string;
  /** Bar tak pernah bersembunyi (Kanban setinggi viewport). */
  pinned?: boolean;
}) {
  return (
    <HeadroomFrame pinned={pinned} className="gap-3">
      <HeadroomBar tour={tour} className="space-y-3 pt-1 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">{title}</h1>
          {actions ? (
            <div data-tour={actionsTour} className="flex flex-wrap items-center gap-2">
              {actions}
            </div>
          ) : null}
        </div>
        {filters}
      </HeadroomBar>
      <div className="min-w-0">{children}</div>
      {bulkBar}
    </HeadroomFrame>
  );
}
