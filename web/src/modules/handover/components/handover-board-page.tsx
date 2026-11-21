import type { HandoverDto } from '@shared/contract';
import type { HandoverStatus } from '@shared/handover';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FilterBar, FilterChip } from '@/components/page/filter-bar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { describeError } from '@/lib/api/describe-error';
import { customerLinkAccess } from '@/lib/link-access';
import { canAt, locationsWith } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { useActiveLocations } from '@/modules/location/active-locations-context';
import { NoLocationNotice } from '@/modules/location/components/no-location-notice';
import { readableLocationIds } from '../lib/readable-locations';
import { scopedLocationIds } from '../lib/search';
import { useSendComment } from '../lib/send-comment';
import { useCheckQueue } from '../lib/use-check-queue';
import { usePendingCreates } from '../lib/use-pending-creates';
import { usePendingIds } from '../lib/use-pending-ids';
import {
  handoverKeys,
  useCancelHandover,
  useHandoverBoard,
  useReopenHandover,
  useSetDone,
} from '../queries';
import { HandoverBoard } from './handover-board';

export interface HandoverBoardPageProps {
  /** Filter daftar kartu ponsel (search param rute). */
  status: HandoverStatus | 'all';
  /** Lokasi dari URL (notifikasi): papan memuat lokasi ini, bukan pilihan lokasi header. */
  locationId?: string;
  /** Hanya task milik customer ini (search param `customer`; keputusan pemilik 2026-11-21). */
  customerId?: string;
  /** Menghapus filter customer (mengganti entri riwayat, bukan menambah). */
  onClearCustomer?: () => void;
  onStatusChange: (status: HandoverStatus | 'all') => void;
  onOpen: (id: string) => void;
  onEdit: (id: string) => void;
  onCreate: () => void;
}

/** Halaman board: satu permintaan berkursor `handovers.board` per kolom (4 paralel) untuk lokasi terpilih yang boleh dibaca. */
export function HandoverBoardPage({
  status,
  locationId,
  customerId,
  onClearCustomer,
  onStatusChange,
  onOpen,
  onEdit,
  onCreate,
}: HandoverBoardPageProps) {
  const me = useMe();
  const queryClient = useQueryClient();
  const { selectedIds } = useActiveLocations();
  // Hanya lokasi terpilih yang boleh dibaca user (WH view ke atas atau QC edit); selebihnya tidak diminta.
  const readable = readableLocationIds(me, scopedLocationIds(locationId, selectedIds));
  const canCreate = locationsWith(me, 'handover', 'edit', selectedIds).length > 0;
  const board = useHandoverBoard(readable, customerId);
  // Nama customer pada chip: dari task yang termuat; tanpa task = label umum (tak ada pembacaan customer lain).
  const customerLabel = customerId
    ? (board.handovers.find((task) => task.customerId === customerId)?.customerName ??
      'Customer terpilih')
    : undefined;
  const setDone = useSetDone();
  const cancel = useCancelHandover();
  const reopen = useReopenHandover();
  const sendComment = useSendComment(me.email);
  const { isPending, track } = usePendingIds();
  // Task baru yang masih di antrean perangkat (hanya lokasi terpilih): kartu sementara di kolom Baru.
  const pendingCreates = usePendingCreates(me.email, readable).flatMap((entry) =>
    entry.tasks.map((task) => ({
      key: `${entry.id}:${task.clientId}`,
      customerName: task.customerName,
      note: task.note,
      status: entry.status,
    })),
  );
  // Centang instan + antrean serial per task; aksi lain menunggu antrean centang task itu kosong.
  const checks = useCheckQueue(me.email);
  const locationNames = new Map(me.locations.map((location) => [location.id, location.name]));

  // Gagal (mis. CONFLICT karena catatan berubah): tampilkan pesan dan muat ulang papan agar tidak basi.
  const onError = (error: unknown) => {
    toast.error(describeError(error));
    void queryClient.invalidateQueries({ queryKey: handoverKeys.boards });
  };

  // Mutasi dilacak per task: hanya kartu yang sedang diproses yang dinonaktifkan.
  const run = (id: string, action: () => Promise<unknown>, onSuccess?: () => void) =>
    void track(id, action).then(onSuccess, onError);

  const bindings = (handover: HandoverDto) => {
    const ref = { id: handover.id, locationId: handover.locationId };
    return {
      owner: me.email,
      canMarkDone: canAt(me, 'qc', 'edit', handover.locationId),
      canEdit: canAt(me, 'handover', 'edit', handover.locationId),
      canCancel: canAt(me, 'handover', 'manage', handover.locationId),
      pending: isPending(handover.id),
      locationName: readable.length > 1 ? locationNames.get(handover.locationId) : undefined,
      canOpenCustomer: customerLinkAccess(me).openCustomerHref !== undefined,
      onOpen: () => onOpen(handover.id),
      onCheck: (item: { index: number; text: string }, checked: boolean) =>
        checks.toggle(ref, item, checked),
      saving: checks.isSaving(handover.id),
      onMarkDone: () =>
        run(handover.id, async () => {
          await checks.whenIdle(handover.id);
          return setDone.mutateAsync(ref);
        }),
      onReopen: () =>
        run(
          handover.id,
          async () => {
            await checks.whenIdle(handover.id);
            return reopen.mutateAsync(ref);
          },
          () => toast.success('Task dibuka kembali'),
        ),
      onEdit: () => onEdit(handover.id),
      onCancel: () =>
        run(
          handover.id,
          async () => {
            await checks.whenIdle(handover.id);
            return cancel.mutateAsync(ref);
          },
          () => toast.success('Task dibatalkan'),
        ),
      // Galat komentar ditampilkan oleh composer (draf dipertahankan), jadi dilempar kembali.
      onComment: async (input: { quote: string; before: string; after: string; body: string }) => {
        await track(handover.id, () => sendComment({ ...ref, ...input }));
      },
    };
  };

  return (
    // Desktop: tinggi halaman = sisa viewport (header 3,5 rem + padding 3 rem) agar HANYA daftar kartu tiap kolom
    // yang bergulir; ponsel bergulir normal.
    <div
      data-tour="handover-board"
      className="flex min-h-0 flex-col gap-4 md:h-[calc(100svh-6.5rem)]"
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Serah Terima</h1>
        {canCreate ? (
          <Button data-tour="handover-new" onClick={onCreate}>
            Tambah task
          </Button>
        ) : null}
      </div>
      {customerId ? (
        <FilterBar>
          <FilterChip label="Customer" display={customerLabel} onClear={onClearCustomer}>
            <div className="space-y-2 text-sm">
              <p>Menampilkan task milik customer ini saja.</p>
              <Button type="button" size="sm" variant="outline" onClick={onClearCustomer}>
                Hapus filter
              </Button>
            </div>
          </FilterChip>
        </FilterBar>
      ) : null}
      <NoLocationNotice />
      {readable.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Pilih lokasi di header yang Anda punya akses serah terima atau QC-nya.
        </p>
      ) : board.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : board.isError ? (
        <p role="alert" className="text-sm text-destructive-text">
          Gagal memuat task. Coba muat ulang.
        </p>
      ) : board.total === 0 && pendingCreates.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {customerId
            ? 'Belum ada task serah terima untuk customer ini di lokasi terpilih.'
            : 'Belum ada task serah terima di lokasi ini.'}
        </p>
      ) : (
        <HandoverBoard
          handovers={board.handovers}
          columns={board.columns}
          filter={status}
          onFilterChange={onStatusChange}
          bindings={bindings}
          pendingCreates={pendingCreates}
        />
      )}
    </div>
  );
}
