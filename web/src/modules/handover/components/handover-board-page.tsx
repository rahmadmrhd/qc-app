import type { HandoverDto } from '@shared/rpc';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { describeError } from '@/lib/rpc/describe-error';
import { canAt, locationsWith } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { useActiveLocations } from '@/modules/location/active-locations-context';
import { readableLocationIds } from '../lib/readable-locations';
import {
  handoverBoardQueryOptions,
  handoverKeys,
  useCancelHandover,
  useSetCheck,
  useSetDone,
} from '../queries';
import { HandoverBoard } from './handover-board';

export interface HandoverBoardPageProps {
  onOpen: (id: string) => void;
  onEdit: (id: string) => void;
  onCreate: () => void;
}

/** Halaman board: SATU RPC `handovers.board` untuk seluruh lokasi terpilih yang boleh dibaca. */
export function HandoverBoardPage({ onOpen, onEdit, onCreate }: HandoverBoardPageProps) {
  const me = useMe();
  const queryClient = useQueryClient();
  const { selectedIds } = useActiveLocations();
  // Hanya lokasi terpilih yang boleh dibaca user (WH view ke atas atau QC edit); selebihnya tidak diminta.
  const readable = readableLocationIds(me, selectedIds);
  const canCreate = locationsWith(me, 'handover', 'edit', selectedIds).length > 0;
  const query = useQuery(handoverBoardQueryOptions(readable));
  const setCheck = useSetCheck();
  const setDone = useSetDone();
  const cancel = useCancelHandover();
  const pending = setCheck.isPending || setDone.isPending || cancel.isPending;
  const locationNames = new Map(me.locations.map((location) => [location.id, location.name]));

  // Gagal (mis. CONFLICT karena catatan berubah): tampilkan pesan dan muat ulang papan agar tidak basi.
  const onError = (error: unknown) => {
    toast.error(describeError(error));
    void queryClient.invalidateQueries({ queryKey: handoverKeys.boards });
  };

  const bindings = (handover: HandoverDto) => {
    const ref = { id: handover.id, locationId: handover.locationId };
    return {
      canMarkDone: canAt(me, 'qc', 'edit', handover.locationId),
      canEdit: canAt(me, 'handover', 'edit', handover.locationId),
      canCancel: canAt(me, 'handover', 'manage', handover.locationId),
      pending,
      locationName: readable.length > 1 ? locationNames.get(handover.locationId) : undefined,
      onOpen: () => onOpen(handover.id),
      onCheck: (item: { index: number; text: string }, checked: boolean) =>
        setCheck.mutate({ ...ref, index: item.index, text: item.text, checked }, { onError }),
      onToggleDone: (done: boolean) => setDone.mutate({ ...ref, done }, { onError }),
      onEdit: () => onEdit(handover.id),
      onCancel: () =>
        cancel.mutate(ref, { onSuccess: () => toast.success('Task dibatalkan'), onError }),
    };
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Serah Terima</h1>
        {canCreate ? <Button onClick={onCreate}>Tambah task</Button> : null}
      </div>
      {readable.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Pilih lokasi di header yang Anda punya akses serah terima atau QC-nya.
        </p>
      ) : query.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : query.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Gagal memuat task. Coba muat ulang.
        </p>
      ) : query.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">Belum ada task serah terima di lokasi ini.</p>
      ) : (
        <HandoverBoard handovers={query.data} bindings={bindings} />
      )}
    </div>
  );
}
