import type { HandoverDto } from '@shared/contract';
import type { HandoverStatus } from '@shared/handover';
import type { ReactNode } from 'react';
import { Component } from 'react';
import { KanbanBoard, type KanbanColumn } from '@/components/kanban/kanban-board';
import { ListState } from '@/components/page/list-state';
import { Button } from '@/components/ui/button';
import { useIsDesktop } from '@/hooks/use-is-desktop';
import { hasIntersectionObserver, useOnNear } from '@/lib/near-viewport';
import { BOARD_STATUSES, filterByStatus, groupBoard } from '../lib/group-board';
import { badgeColorOf, HANDOVER_STATUS_LABELS } from '../lib/status';
import type { BoardColumnState } from '../queries';
import type { HandoverCardProps } from './handover-card';
import { HandoverCard } from './handover-card';
import { PendingCreateCard, type PendingCreateView } from './pending-create-card';

export type CardBindings = Omit<HandoverCardProps, 'handover'>;

export interface HandoverBoardProps {
  handovers: readonly HandoverDto[];
  /**
   * Filter daftar kartu (ponsel); disimpan pemanggil (search param) agar bertahan saat kembali dari detail. Pilihannya
   * ada di chip "Status" bar filter halaman (`HandoverBoardPage`), bukan di papan ini.
   */
  filter: HandoverStatus | 'all';
  /** Dipakai tombol "hapus filter" saat daftar kosong karena filter. */
  onFilterChange: (filter: HandoverStatus | 'all') => void;
  /** Total dan pemuatan halaman berikutnya per kolom (papan berkursor); tanpa ini hanya yang diberikan yang tampil. */
  columns?: Record<HandoverStatus, BoardColumnState>;
  /** Izin dan penangan untuk satu kartu (izin dihitung per lokasi task). */
  bindings: (handover: HandoverDto) => CardBindings;
  /** Task baru yang masih di antrean perangkat: kartu sementara di kolom Baru (desktop) atau awal daftar (ponsel). */
  pendingCreates?: readonly PendingCreateView[];
}

const NO_PENDING: readonly PendingCreateView[] = [];

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
          className="rounded-lg border border-destructive p-3 text-sm text-destructive-text"
        >
          Task {this.props.number} tidak dapat ditampilkan (data rusak).
        </p>
      );
    }
    return this.props.children;
  }
}

function SafeCard({
  handover,
  bindings,
  framed,
}: {
  handover: HandoverDto;
  bindings: CardBindings;
  framed: boolean;
}) {
  return (
    <CardBoundary number={String(handover.number ?? handover.id ?? '?')}>
      <HandoverCard handover={handover} {...bindings} framed={framed} />
    </CardBoundary>
  );
}

/**
 * Halaman berikutnya dimuat OTOMATIS saat akhir daftar mendekati layar (infinite scroll, daftar kartu ponsel); karena
 * sentinel diamati ulang tiap jumlah task termuat berubah, daftar yang belum penuh layar terisi sendiri. Tanpa
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
        color="primary"
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

/** Isi satu kolom kanban: kartu sementara (antrean perangkat) di kolom Baru, lalu task sungguhan. */
type KanbanItem =
  | { kind: 'pending'; view: PendingCreateView }
  | { kind: 'task'; handover: HandoverDto };

const kanbanKey = (item: KanbanItem): string =>
  item.kind === 'pending' ? `pending:${item.view.key}` : item.handover.id;

/**
 * Papan Serah Terima. Layar lebar: `KanbanBoard` kit (empat kolom berwarna sesuai status, setinggi sisa viewport,
 * tiap kolom menggulir sendiri dan memuat halaman berikutnya otomatis). Layar sempit: daftar kartu yang disaring
 * menurut `filter` (dipilih lewat chip Status di bar filter halaman), memakai `ListState` untuk keadaan kosong.
 */
export function HandoverBoard({
  handovers,
  filter,
  onFilterChange,
  columns: columnState,
  bindings,
  pendingCreates = NO_PENDING,
}: HandoverBoardProps) {
  const desktop = useIsDesktop();

  if (desktop) {
    const grouped = groupBoard(handovers);
    const columns: KanbanColumn<KanbanItem>[] = BOARD_STATUSES.map((status) => {
      const state = columnState?.[status];
      const tasks = grouped[status].map((handover): KanbanItem => ({ kind: 'task', handover }));
      const pendings = (status === 'new' ? pendingCreates : NO_PENDING).map(
        (view): KanbanItem => ({ kind: 'pending', view }),
      );
      return {
        key: status,
        label: HANDOVER_STATUS_LABELS[status],
        color: badgeColorOf(status),
        items: [...pendings, ...tasks],
        // Judul kolom = jumlah di server (tanpa kartu sementara yang belum ada di server).
        total: state?.total ?? tasks.length,
        hasMore: state?.hasMore ?? false,
        loadingMore: state?.loadingMore ?? false,
        ...(state ? { onLoadMore: state.loadMore } : {}),
      };
    });
    return (
      <KanbanBoard
        label="Papan Serah Terima"
        height="viewport"
        columns={columns}
        itemKey={kanbanKey}
        emptyText="Tidak ada task."
        renderCard={(item) =>
          item.kind === 'pending' ? (
            <PendingCreateCard task={item.view} />
          ) : (
            <SafeCard handover={item.handover} bindings={bindings(item.handover)} framed={false} />
          )
        }
      />
    );
  }

  const visible = filterByStatus(handovers, filter);
  const showPending = filter === 'all' || filter === 'new';
  const pendingShown = showPending ? pendingCreates : NO_PENDING;
  return (
    <div className="space-y-3" data-layout="list">
      <ListState
        isEmpty={visible.length === 0 && pendingShown.length === 0}
        filtered={filter !== 'all'}
        onClearFilters={() => onFilterChange('all')}
        empty="Tidak ada task."
      >
        <div className="space-y-3">
          {pendingShown.map((task) => (
            <PendingCreateCard key={task.key} task={task} />
          ))}
          {visible.map((handover) => (
            <SafeCard key={handover.id} handover={handover} bindings={bindings(handover)} framed />
          ))}
        </div>
      </ListState>
      {filter === 'all' ? (
        BOARD_STATUSES.map((status) => <LoadMore key={status} column={columnState?.[status]} />)
      ) : (
        <LoadMore column={columnState?.[filter]} />
      )}
    </div>
  );
}
