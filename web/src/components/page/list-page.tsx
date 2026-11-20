import { type ReactNode, useState } from 'react';
import { ACTIONS, ActionButton, type ActionKind } from '@/components/action-button';
import { Button } from '@/components/ui/button';
import { useIsDesktop } from '@/hooks/use-is-desktop';
import { BulkActiveContext } from './bulk-active';
import { HeadroomBar, HeadroomFrame } from './headroom-bar';

/** Aksi utama halaman daftar (mis. Tambah): tombol di header >= 768 px, tombol mengambang (FAB 48 px) di ponsel. */
export interface ListCreateAction {
  label: string;
  onClick: () => void;
  /** Jenis aksi untuk ikon, warna, dan gaya (bawaan `create`). */
  kind?: ActionKind;
}

/**
 * Kerangka halaman daftar (spek redesain 6.5): bar headroom (judul + aksi + filter), isi, lalu bar aksi massal
 * yang menempel di bawah layar.
 */
export function ListPage({
  title,
  actions,
  createAction,
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
    <HeadroomFrame pinned={pinned} className={fab ? 'gap-3 max-md:pb-20' : 'gap-3'}>
      <HeadroomBar tour={tour} className="space-y-3 pt-1 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">{title}</h1>
          {hasActions ? (
            <div data-tour={actionsTour} className="flex flex-wrap items-center gap-2">
              {headerAction ? (
                <ActionButton
                  action={headerAction.kind ?? 'create'}
                  label={headerAction.label}
                  onClick={headerAction.onClick}
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
      {fab && !bulkActive ? <FloatingCreateButton action={fab} /> : null}
    </HeadroomFrame>
  );
}

/** FAB 48 px kanan bawah (ikon saja; `aria-label` = label aksi), menghormati area aman. */
function FloatingCreateButton({ action }: { action: ListCreateAction }) {
  const Icon = ACTIONS[action.kind ?? 'create'].icon;
  return (
    <Button
      type="button"
      size="icon"
      aria-label={action.label}
      onClick={action.onClick}
      className="fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-30 size-12 rounded-full shadow-lg max-md:size-12"
    >
      <Icon aria-hidden className="size-5" />
    </Button>
  );
}
