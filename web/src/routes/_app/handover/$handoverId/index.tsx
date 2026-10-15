import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { describeError } from '@/lib/rpc/describe-error';
import { RpcError } from '@/lib/rpc/rpc-error';
import { can, canAt, requireAnyPermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { HandoverDetailView } from '@/modules/handover/components/handover-detail-view';
import { readableLocationIds } from '@/modules/handover/lib/readable-locations';
import {
  handoverKeys,
  handoverQueryOptions,
  useCancelHandover,
  useCompleteAll,
  useCompleteLine,
  useSetProgress,
} from '@/modules/handover/queries';
import { useActiveLocations } from '@/modules/location/active-locations-context';

export const Route = createFileRoute('/_app/handover/$handoverId/')({
  beforeLoad: ({ context }) =>
    requireAnyPermission(context.queryClient, [
      { module: 'handover', level: 'view' },
      { module: 'qc', level: 'edit' },
    ]),
  component: HandoverDetailPage,
});

function HandoverDetailPage() {
  const { handoverId } = Route.useParams();
  const navigate = useNavigate();
  const me = useMe();
  const { selectedIds } = useActiveLocations();
  // Hanya lokasi yang boleh dibaca user: satu lokasi terlarang menolak seluruh permintaan.
  const readable = readableLocationIds(me, selectedIds);
  const query = useQuery(handoverQueryOptions(handoverId, readable));
  const queryClient = useQueryClient();
  const setProgress = useSetProgress();
  const completeLine = useCompleteLine();
  const completeAll = useCompleteAll();
  const cancel = useCancelHandover();
  const pending =
    setProgress.isPending || completeLine.isPending || completeAll.isPending || cancel.isPending;

  const task = query.data;
  if (query.isPending && readable.length > 0) return <Skeleton className="h-64 w-full" />;
  if (!task) {
    const notFound = !(query.error instanceof RpcError) || query.error.code === 'NOT_FOUND';
    if (!notFound) {
      return (
        <p role="alert" className="text-sm text-destructive">
          Gagal memuat task. Coba muat ulang.{' '}
          <Link to="/handover" className="underline">
            Kembali ke daftar
          </Link>
        </p>
      );
    }
    return (
      <p role="alert" className="text-sm text-destructive">
        Task tidak ditemukan di lokasi aktif.{' '}
        <Link to="/handover" className="underline">
          Kembali ke daftar
        </Link>
      </p>
    );
  }

  const ref = { id: task.id, locationId: task.locationId };
  const done = (message: string) => ({
    onSuccess: () => toast.success(message),
    onError: (error: unknown) => {
      toast.error(describeError(error));
      // Gagal (mis. CONFLICT karena QC lain baru menyelesaikan task): muat ulang agar isian tidak basi.
      void queryClient.invalidateQueries({ queryKey: handoverKeys.all });
    },
  });
  const locationName =
    me.locations.find((location) => location.id === task.locationId)?.name ?? task.locationId;
  return (
    <HandoverDetailView
      handover={task}
      locationName={locationName}
      canEdit={canAt(me, 'handover', 'edit', task.locationId)}
      canCancel={canAt(me, 'handover', 'manage', task.locationId)}
      canProgress={canAt(me, 'qc', 'edit', task.locationId)}
      renderItemLink={
        can(me, 'item', 'view')
          ? (itemId, label) => (
              <Link
                to="/item/$itemId"
                params={{ itemId }}
                className="underline-offset-2 hover:underline"
              >
                {label}
              </Link>
            )
          : undefined
      }
      pending={pending}
      onBack={() => void navigate({ to: '/handover' })}
      onEdit={() => void navigate({ to: '/handover/$handoverId/edit', params: { handoverId } })}
      onCancel={() => cancel.mutate(ref, done('Task dibatalkan'))}
      onSetProgress={(lineId, doneQty) =>
        setProgress.mutate({ ...ref, lineId, doneQty }, done('Progres disimpan'))
      }
      onCompleteLine={(lineId) =>
        completeLine.mutate({ ...ref, lineId }, done('Tipe ditandai selesai'))
      }
      onCompleteAll={() => completeAll.mutate(ref, done('Task selesai'))}
    />
  );
}
