import type { HandoverDto } from '@shared/contract';
import type { HandoverStatus } from '@shared/handover';
import type { ReactNode } from 'react';
import { Component, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { BOARD_STATUSES, filterByStatus, groupBoard } from '../lib/group-board';
import { hasIntersectionObserver, ScrollRootProvider, useOnNear } from '../lib/near-viewport';
import { HANDOVER_STATUS_LABELS, HANDOVER_STATUS_STYLES } from '../lib/status';
import type { BoardColumnState } from '../queries';
import type { HandoverCardProps } from './handover-card';
import { HandoverCard } from './handover-card';

export type CardBindings = Omit<HandoverCardProps, 'handover'>;

export interface HandoverBoardProps {
  handovers: readonly HandoverDto[];
  /** Filter daftar kartu (ponsel); disimpan pemanggil (search param) agar bertahan saat kembali dari detail. */
  filter: HandoverStatus | 'all';
  onFilterChange: (filter: HandoverStatus | 'all') => void;
  /** Total dan pemuatan halaman berikutnya per kolom (papan berkursor); tanpa ini hanya yang diberikan yang tampil. */
  columns?: Record<HandoverStatus, BoardColumnState>;
  /** Izin dan penangan untuk satu kartu (izin dihitung per lokasi task). */
  bindings: (handover: HandoverDto) => CardBindings;
}

const DESKTOP_QUERY = '(min-width: 768px)';

/** Lebar ≥ 768 px = kanban; lebih sempit = daftar kartu. Tanpa `matchMedia` (mis. jsdom) dianggap lebar. */
export function useIsDesktop(): boolean {
  const read = () =>
    typeof window.matchMedia === 'function' ? window.matchMedia(DESKTOP_QUERY).matches : true;
  const [desktop, setDesktop] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(DESKTOP_QUERY);
    const update = () => setDesktop(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return desktop;
}

/** Data satu task yang rusak hanya menjatuhkan kartunya sendiri, bukan seluruh board. */
class CardBoundary extends Component<{ number: string; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    if (this.state.failed) {
      return (
        <p
          role="alert"
          className="rounded-lg border border-destructive p-3 text-sm text-destructive"
        >
          Task {this.props.number} tidak dapat ditampilkan (data rusak).
        </p>
      );
    }
    return this.props.children;
  }
}

function SafeCard({ handover, bindings }: { handover: HandoverDto; bindings: CardBindings }) {
  return (
    <CardBoundary number={String(handover.number ?? handover.id ?? '?')}>
      <HandoverCard handover={handover} {...bindings} />
    </CardBoundary>
  );
}

const FILTERS: ReadonlyArray<{ value: HandoverStatus | 'all'; label: string }> = [
  { value: 'all', label: 'Semua' },
  ...BOARD_STATUSES.map((status) => ({ value: status, label: HANDOVER_STATUS_LABELS[status] })),
];

/**
 * Halaman berikutnya dimuat OTOMATIS saat akhir daftar mendekati layar (infinite scroll); karena sentinel diamati
 * ulang tiap jumlah task termuat berubah, kolom yang belum penuh layar terisi sendiri. Tanpa
 * `IntersectionObserver` (mis. jsdom) tersedia tombol "Muat lebih banyak".
 */
function LoadMore({ column }: { column: BoardColumnState | undefined }) {
  const active = Boolean(column?.hasMore) && !column?.loadingMore;
  const sentinel = useOnNear(active, column?.loaded, () => column?.loadMore());
  if (!column?.hasMore) return null;
  if (!hasIntersectionObserver()) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        disabled={column.loadingMore}
        onClick={column.loadMore}
      >
        {column.loadingMore ? 'Memuat…' : 'Muat lebih banyak'}
      </Button>
    );
  }
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

/** Daftar kartu satu kolom kanban; elemen gulirnya menjadi akar pengamat (lazy kartu dan muat otomatis). */
function ColumnCards({ children }: { children: ReactNode }) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  return (
    <div
      ref={setRoot}
      className="min-h-0 flex-1 space-y-3 overflow-y-auto"
      data-slot="column-cards"
    >
      <ScrollRootProvider root={root}>{children}</ScrollRootProvider>
    </div>
  );
}

export function HandoverBoard({
  handovers,
  filter,
  onFilterChange,
  columns: columnState,
  bindings,
}: HandoverBoardProps) {
  const desktop = useIsDesktop();

  if (desktop) {
    const columns = groupBoard(handovers);
    // Tinggi papan = sisa tinggi viewport: judul dan hitungan kolom tetap di atas, hanya daftar kartu yang bergulir.
    return (
      <div className="grid min-h-0 flex-1 grid-cols-4 gap-3" data-layout="kanban">
        {BOARD_STATUSES.map((status) => (
          <section
            key={status}
            aria-label={`Kolom ${HANDOVER_STATUS_LABELS[status]}`}
            className={cn(
              'flex min-h-0 flex-col rounded-lg border-t-4 p-2',
              HANDOVER_STATUS_STYLES[status].column,
            )}
          >
            <h2 className="shrink-0 px-1 pb-2 text-sm font-semibold">
              {HANDOVER_STATUS_LABELS[status]} (
              {columnState?.[status].total ?? columns[status].length})
            </h2>
            <ColumnCards>
              {columns[status].length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">Tidak ada task.</p>
              ) : (
                columns[status].map((handover) => (
                  <SafeCard key={handover.id} handover={handover} bindings={bindings(handover)} />
                ))
              )}
              <LoadMore column={columnState?.[status]} />
            </ColumnCards>
          </section>
        ))}
      </div>
    );
  }

  const visible = filterByStatus(handovers, filter);
  return (
    <div className="space-y-3" data-layout="list">
      <fieldset aria-label="Filter status" className="flex flex-wrap gap-1 border-0 p-0">
        {FILTERS.map(({ value, label }) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={filter === value ? 'secondary' : 'outline'}
            aria-pressed={filter === value}
            onClick={() => onFilterChange(value)}
          >
            {label}
          </Button>
        ))}
      </fieldset>
      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">Tidak ada task.</p>
      ) : (
        visible.map((handover) => (
          <SafeCard key={handover.id} handover={handover} bindings={bindings(handover)} />
        ))
      )}
      {filter === 'all' ? (
        BOARD_STATUSES.map((status) => <LoadMore key={status} column={columnState?.[status]} />)
      ) : (
        <LoadMore column={columnState?.[filter]} />
      )}
    </div>
  );
}
