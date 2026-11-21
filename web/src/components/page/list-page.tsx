import { type ReactNode, useState } from 'react';
import { ActionButton, type ActionKind } from '@/components/action-button';
import { useIsDesktop } from '@/hooks/use-is-desktop';
import { BulkActiveContext } from './bulk-active';
import { Fab } from './fab';
import { HeadroomBar, HeadroomFrame } from './headroom-bar';
import { ScrollToTop } from './scroll-to-top';

/** Aksi utama halaman daftar (mis. Tambah): tombol di header >= 768 px, tombol mengambang (FAB 56 px) di ponsel. */
export interface ListCreateAction {
  label: string;
  onClick: () => void;
  /** Jenis aksi untuk ikon, warna, dan gaya (bawaan `create`). */
  kind?: ActionKind;
  /** `data-tour` pada tombol (header di desktop, FAB di ponsel). */
  tour?: string;
}

/**
 * Kerangka halaman daftar (spek redesain 6.5): bar headroom (judul + aksi + filter), isi, lalu bar aksi massal
 * yang menempel di bawah layar.
 */
export function ListPage({
  title,
  actions,
  createAction,
  count,
  filters,
  bulkBar,
  children,
  tour,
  actionsTour,
  pinned,
}: {
  title: ReactNode;
  actions?: ReactNode;
  /** Aksi utama: header di desktop, FAB di ponsel (disembunyikan saat mode pilih). */
  createAction?: ListCreateAction;
  /** Hitungan hasil di samping judul, mis. "12 item" (diumumkan sopan ke pembaca layar). */
  count?: ReactNode;
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
  const desktop = useIsDesktop();
  const [bulkActive, setBulkActive] = useState(false);
  const fab = !desktop && createAction ? createAction : null;
  const headerAction = desktop && createAction ? createAction : null;
  const hasActions = Boolean(actions) || headerAction !== null;
  return (
    <HeadroomFrame pinned={pinned} className={fab ? 'gap-3 narrow:pb-24' : 'gap-3'}>
      <HeadroomBar tour={tour} className="space-y-3 pt-1 pb-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <h1 className="text-xl font-semibold">{title}</h1>
            {count ? (
              <span role="status" className="text-sm text-muted-foreground">
                {count}
              </span>
            ) : null}
          </div>
          {hasActions ? (
            <div data-tour={actionsTour} className="flex flex-wrap items-center gap-2">
              {headerAction ? (
                <ActionButton
                  action={headerAction.kind ?? 'create'}
                  label={headerAction.label}
                  onClick={headerAction.onClick}
                  data-tour={headerAction.tour}
                />
              ) : null}
              {actions}
            </div>
          ) : null}
        </div>
        {filters}
      </HeadroomBar>
      <div className="min-w-0">{children}</div>
      <BulkActiveContext.Provider value={setBulkActive}>{bulkBar}</BulkActiveContext.Provider>
      {!desktop && !bulkActive ? <ScrollToTop aboveFab={fab !== null} /> : null}
      {fab && !bulkActive ? (
        <Fab
          label={fab.label}
          onClick={fab.onClick}
          kind={fab.kind ?? 'create'}
          {...(fab.tour ? { tour: fab.tour } : {})}
        />
      ) : null}
    </HeadroomFrame>
  );
}
