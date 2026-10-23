import type { HandoverStatus } from '@shared/handover';
import type { HandoverDto } from '@shared/rpc';
import type { ReactNode } from 'react';
import { Component, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { BOARD_STATUSES, filterByStatus, groupBoard } from '../lib/group-board';
import { HANDOVER_STATUS_LABELS } from '../lib/status';
import type { HandoverCardProps } from './handover-card';
import { HandoverCard } from './handover-card';

export type CardBindings = Omit<HandoverCardProps, 'handover'>;

export interface HandoverBoardProps {
  handovers: readonly HandoverDto[];
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

export function HandoverBoard({ handovers, bindings }: HandoverBoardProps) {
  const desktop = useIsDesktop();
  const [filter, setFilter] = useState<HandoverStatus | 'all'>('all');

  if (desktop) {
    const columns = groupBoard(handovers);
    return (
      <div className="grid grid-cols-4 items-start gap-3" data-layout="kanban">
        {BOARD_STATUSES.map((status) => (
          <section
            key={status}
            aria-label={`Kolom ${HANDOVER_STATUS_LABELS[status]}`}
            className="space-y-3 rounded-lg bg-muted/40 p-2"
          >
            <h2 className="px-1 text-sm font-semibold">
              {HANDOVER_STATUS_LABELS[status]} ({columns[status].length})
            </h2>
            {columns[status].length === 0 ? (
              <p className="px-1 text-xs text-muted-foreground">Tidak ada task.</p>
            ) : (
              columns[status].map((handover) => (
                <SafeCard key={handover.id} handover={handover} bindings={bindings(handover)} />
              ))
            )}
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
            onClick={() => setFilter(value)}
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
    </div>
  );
}
