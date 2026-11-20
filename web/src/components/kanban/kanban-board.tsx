import { cn } from 'cn';
import { type ReactNode, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { UiColor } from '@/components/ui/variant-style';
import { hasIntersectionObserver, ScrollRootProvider, useOnNear } from '@/lib/near-viewport';

export interface KanbanColumn<T> {
  key: string;
  label: string;
  color: UiColor;
  items: readonly T[];
  /** Total di server (bila lebih besar dari yang termuat); bawaan jumlah item. */
  total?: number;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
}

/** Kelas statis per warna (Tailwind tak dapat menyusun nama kelas dinamis): garis atas, latar tipis, bingkai, garis kiri kartu. */
const TONE: Record<UiColor, { column: string; card: string }> = {
  primary: {
    column: 'border-t-foreground border-foreground/20 bg-foreground/5',
    card: 'border-l-foreground',
  },
  secondary: {
    column: 'border-t-secondary-text border-secondary-text/25 bg-secondary-text/5',
    card: 'border-l-secondary-text',
  },
  success: {
    column: 'border-t-success-text border-success-text/25 bg-success-text/5',
    card: 'border-l-success-text',
  },
  warning: {
    column: 'border-t-warning-text border-warning-text/25 bg-warning-text/5',
    card: 'border-l-warning-text',
  },
  info: {
    column: 'border-t-info-text border-info-text/25 bg-info-text/5',
    card: 'border-l-info-text',
  },
  destructive: {
    column: 'border-t-destructive-text border-destructive-text/25 bg-destructive-text/5',
    card: 'border-l-destructive-text',
  },
};

const BANNER_SELECTOR = '[data-app-banner]';

function touchesBanner(nodes: NodeList): boolean {
  for (const node of nodes) {
    if (
      node instanceof Element &&
      (node.matches(BANNER_SELECTOR) || node.querySelector(BANNER_SELECTOR))
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Jumlah tinggi (px) semua spanduk aplikasi yang sedang tampil (`data-app-banner`). Hanya mengukur ulang saat
 * spanduk ditambah/dibuang dari DOM (MutationObserver menyaring catatan yang tak menyentuh spanduk) atau saat ukuran
 * spanduk berubah (ResizeObserver), digabung per frame, jadi perubahan DOM lain (kartu, toast) tak memicu layout paksa.
 */
function useAppBannerHeight(enabled: boolean): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    const resize =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => schedule());
    const observed = new Set<Element>();
    const measure = () => {
      frame = 0;
      let sum = 0;
      const banners = document.querySelectorAll(BANNER_SELECTOR);
      for (const element of banners) sum += element.getBoundingClientRect().height;
      setHeight(Math.round(sum));
      if (resize) {
        const current = new Set<Element>(banners);
        for (const element of observed) {
          if (!current.has(element)) {
            resize.unobserve(element);
            observed.delete(element);
          }
        }
        for (const element of current) {
          if (!observed.has(element)) {
            resize.observe(element);
            observed.add(element);
          }
        }
      }
    };
    function schedule() {
      if (frame === 0) frame = requestAnimationFrame(measure);
    }
    measure();
    const mutation = new MutationObserver((records) => {
      if (records.some((r) => touchesBanner(r.addedNodes) || touchesBanner(r.removedNodes))) {
        schedule();
      }
    });
    mutation.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', schedule);
    return () => {
      mutation.disconnect();
      resize?.disconnect();
      window.removeEventListener('resize', schedule);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [enabled]);
  return height;
}

/** Celah vertikal antara bar halaman dan isi (`gap-3` pada `ListPage`/`ViewPage`). */
const FRAME_GAP = '0.75rem';

/** Tombol/penanda "Muat lebih banyak" satu kolom (otomatis di mode viewport bila `IntersectionObserver` ada). */
function ColumnLoadMore<T>({ column, auto }: { column: KanbanColumn<T>; auto: boolean }) {
  const active = auto && Boolean(column.hasMore) && !column.loadingMore;
  const sentinel = useOnNear(active, column.items.length, () => column.onLoadMore?.());
  if (!column.hasMore) return null;
  if (auto && hasIntersectionObserver()) {
    return (
      <div ref={sentinel} data-slot="load-more-sentinel" className="min-h-4 text-center">
        {column.loadingMore ? (
          <span role="status" className="text-xs text-muted-foreground">
            Memuat…
          </span>
        ) : null}
      </div>
    );
  }
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="w-full"
      disabled={column.loadingMore}
      onClick={column.onLoadMore}
    >
      {column.loadingMore ? 'Memuat…' : 'Muat lebih banyak'}
    </Button>
  );
}

/** Daftar kartu satu kolom yang menggulir sendiri; elemennya menjadi akar pengamat (kartu lazy dan muat otomatis). */
function ScrollingCards({ children }: { children: ReactNode }) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  return (
    <div
      ref={setRoot}
      data-slot="column-cards"
      className="min-h-0 flex-1 space-y-2 overflow-y-auto"
    >
      <ScrollRootProvider root={root}>{children}</ScrollRootProvider>
    </div>
  );
}

/**
 * Papan kanban berwarna (spek redesain 6.5): kolom selebar minimum ±290 px dan gulir horizontal bila tak muat.
 * `height="viewport"`: wadah setinggi sisa viewport (dikurangi header, bar headroom, spanduk aplikasi yang
 * tampil, padding atas dan bawah `main` (`--main-pad`), dan celah bar-isi) dan tiap kolom menggulir sendiri.
 */
export function KanbanBoard<T>({
  columns,
  itemKey,
  renderCard,
  label,
  emptyText = 'Kosong',
  height = 'auto',
}: {
  columns: readonly KanbanColumn<T>[];
  height?: 'auto' | 'viewport';
  itemKey: (item: T) => string;
  renderCard: (item: T) => ReactNode;
  label: string;
  emptyText?: string;
}) {
  const viewport = height === 'viewport';
  const bannerHeight = useAppBannerHeight(viewport);

  return (
    <section
      aria-label={label}
      data-height={height}
      className={cn('flex gap-3 overflow-x-auto', viewport && 'items-stretch')}
      style={
        viewport
          ? {
              height: `calc(100dvh - var(--headroom-offset, 3.5rem) - ${bannerHeight}px - 2 * var(--main-pad, 1.5rem) - ${FRAME_GAP})`,
            }
          : undefined
      }
    >
      {columns.map((column) => {
        const tone = TONE[column.color];
        const cards = (
          <>
            {column.items.length === 0 ? (
              <p className="px-1 text-xs text-muted-foreground">{emptyText}</p>
            ) : (
              column.items.map((item) => (
                <div key={itemKey(item)} className={cn('rounded-md border-l-4 bg-card', tone.card)}>
                  {renderCard(item)}
                </div>
              ))
            )}
            <ColumnLoadMore column={column} auto={viewport} />
          </>
        );
        return (
          <fieldset
            key={column.key}
            aria-label={column.label}
            className={cn(
              'm-0 flex min-w-[290px] flex-1 flex-col rounded-lg border border-t-[3px] p-2',
              tone.column,
              viewport && 'min-h-0',
            )}
          >
            <div className="flex shrink-0 items-center gap-2 px-1 pb-2">
              <Badge color={column.color} variant="soft">
                {column.label}
              </Badge>
              <span className="text-sm text-muted-foreground tabular-nums">
                {column.total ?? column.items.length}
              </span>
            </div>
            {viewport ? (
              <ScrollingCards>{cards}</ScrollingCards>
            ) : (
              <div className="space-y-2">{cards}</div>
            )}
          </fieldset>
        );
      })}
    </section>
  );
}
