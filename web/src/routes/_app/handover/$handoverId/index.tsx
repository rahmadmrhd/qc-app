import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { describeError } from '@/lib/rpc/describe-error';
import { RpcError } from '@/lib/rpc/rpc-error';
import { canAt, requireAnyPermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { HandoverDetailView } from '@/modules/handover/components/handover-detail-view';
import { readableLocationIds } from '@/modules/handover/lib/readable-locations';
import {
  handoverSearchSchema,
  searchFromStatus,
  statusFromSearch,
} from '@/modules/handover/lib/search';
import {
  handoverKeys,
  handoverQueryOptions,
  useAddComment,
  useCancelHandover,
  useReopenHandover,
  useSetCheck,
  useSetDone,
} from '@/modules/handover/queries';
import { useActiveLocations } from '@/modules/location/active-locations-context';

export const Route = createFileRoute('/_app/handover/$handoverId/')({
  validateSearch: (search: Record<string, unknown>) => handoverSearchSchema.parse(search),
  beforeLoad: ({ context }) =>
    requireAnyPermission(context.queryClient, [
      { module: 'handover', level: 'view' },
      { module: 'qc', level: 'edit' },
    ]),
  component: HandoverDetailPage,
});

function HandoverDetailPage() {
  const { handoverId } = Route.useParams();
  const listSearch = searchFromStatus(statusFromSearch(Route.useSearch()));
  const navigate = useNavigate();
  const me = useMe();
  const { selectedIds } = useActiveLocations();
  // Hanya lokasi yang boleh dibaca user: satu lokasi terlarang menolak seluruh permintaan.
  const readable = readableLocationIds(me, selectedIds);
  const query = useQuery(handoverQueryOptions(handoverId, readable));
  const queryClient = useQueryClient();
  const setCheck = useSetCheck();
  const setDone = useSetDone();
  const addComment = useAddComment();
  const cancel = useCancelHandover();
  const reopen = useReopenHandover();
  const pending = setCheck.isPending || setDone.isPending || cancel.isPending || reopen.isPending;

  const task = query.data;
  if (query.isPending && readable.length > 0) return <Skeleton className="h-64 w-full" />;
  if (!task) {
    const notFound = !(query.error instanceof RpcError) || query.error.code === 'NOT_FOUND';
    return (
      <p role="alert" className="text-sm text-destructive">
        {notFound ? 'Task tidak ditemukan di lokasi aktif.' : 'Gagal memuat task. Coba muat ulang.'}{' '}
        <Link to="/handover" search={listSearch} className="underline">
          Kembali ke daftar
        </Link>
      </p>
    );
  }

  const ref = { id: task.id, locationId: task.locationId };
  // Gagal (mis. CONFLICT karena catatan berubah): muat ulang agar tampilan tidak basi.
  const onError = (error: unknown) => {
    toast.error(describeError(error));
    void queryClient.invalidateQueries({ queryKey: handoverKeys.all });
  };
  const locationName =
    me.locations.find((location) => location.id === task.locationId)?.name ?? task.locationId;
  return (
    <HandoverDetailView
      handover={task}
      locationName={locationName}
      canEdit={canAt(me, 'handover', 'edit', task.locationId)}
      canCancel={canAt(me, 'handover', 'manage', task.locationId)}
      canProgress={canAt(me, 'qc', 'edit', task.locationId)}
      pending={pending}
      onBack={() => void navigate({ to: '/handover', search: listSearch })}
      onEdit={() =>
        void navigate({
          to: '/handover/$handoverId/edit',
          params: { handoverId },
          search: listSearch,
        })
      }
      onCancel={() =>
        cancel.mutate(ref, { onSuccess: () => toast.success('Task dibatalkan'), onError })
      }
      onMarkDone={() => setDone.mutate(ref, { onError })}
      onReopen={() =>
        reopen.mutate(ref, { onSuccess: () => toast.success('Task dibuka kembali'), onError })
      }
      onCheck={(item, checked) =>
        setCheck.mutate({ ...ref, index: item.index, text: item.text, checked }, { onError })
      }
      onComment={async (input) => {
        await addComment.mutateAsync({ ...ref, ...input });
      }}
    />
  );
}
