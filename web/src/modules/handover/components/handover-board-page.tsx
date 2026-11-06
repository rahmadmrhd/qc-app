import type { HandoverStatus } from '@shared/handover';
import type { HandoverDto } from '@shared/rpc';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { describeError } from '@/lib/api/describe-error';
import { canAt, locationsWith } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { useActiveLocations } from '@/modules/location/active-locations-context';
import { readableLocationIds } from '../lib/readable-locations';
import { useCheckQueue } from '../lib/use-check-queue';
import { usePendingIds } from '../lib/use-pending-ids';
import {
  handoverKeys,
  useAddComment,
  useCancelHandover,
  useHandoverBoard,
  useReopenHandover,
  useSetDone,
} from '../queries';
import { HandoverBoard } from './handover-board';

export interface HandoverBoardPageProps {
  /** Filter daftar kartu ponsel (search param rute). */
  status: HandoverStatus | 'all';
  onStatusChange: (status: HandoverStatus | 'all') => void;
  onOpen: (id: string) => void;
  onEdit: (id: string) => void;
  onCreate: () => void;
}

/** Halaman board: satu RPC berkursor `handovers.board` per kolom (4 paralel) untuk lokasi terpilih yang boleh dibaca. */
export function HandoverBoardPage({
  status,
  onStatusChange,
  onOpen,
  onEdit,
  onCreate,
}: HandoverBoardPageProps) {
  const me = useMe();
  const queryClient = useQueryClient();
  const { selectedIds } = useActiveLocations();
  // Hanya lokasi terpilih yang boleh dibaca user (WH view ke atas atau QC edit); selebihnya tidak diminta.
  const readable = readableLocationIds(me, selectedIds);
  const canCreate = locationsWith(me, 'handover', 'edit', selectedIds).length > 0;
  const board = useHandoverBoard(readable);
  const setDone = useSetDone();
  const cancel = useCancelHandover();
  const reopen = useReopenHandover();
  const addComment = useAddComment();
  const { isPending, track } = usePendingIds();
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
      canMarkDone: canAt(me, 'qc', 'edit', handover.locationId),
      canEdit: canAt(me, 'handover', 'edit', handover.locationId),
      canCancel: canAt(me, 'handover', 'manage', handover.locationId),
      pending: isPending(handover.id),
      locationName: readable.length > 1 ? locationNames.get(handover.locationId) : undefined,
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
        await track(handover.id, () => addComment.mutateAsync({ ...ref, ...input }));
      },
    };
  };

  return (
    // Desktop: tinggi halaman = sisa viewport (header 3,5 rem + padding 3 rem) agar HANYA daftar kartu tiap kolom
    // yang bergulir; ponsel bergulir normal.
    <div className="flex min-h-0 flex-col gap-4 md:h-[calc(100svh-6.5rem)]">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Serah Terima</h1>
        {canCreate ? <Button onClick={onCreate}>Tambah task</Button> : null}
      </div>
      {readable.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Pilih lokasi di header yang Anda punya akses serah terima atau QC-nya.
        </p>
      ) : board.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : board.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Gagal memuat task. Coba muat ulang.
        </p>
      ) : board.total === 0 ? (
        <p className="text-sm text-muted-foreground">Belum ada task serah terima di lokasi ini.</p>
      ) : (
        <HandoverBoard
          handovers={board.handovers}
          columns={board.columns}
          filter={status}
          onFilterChange={onStatusChange}
          bindings={bindings}
        />
      )}
    </div>
  );
}
