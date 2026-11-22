import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { PageContent } from '@/components/page/page-container';
import { useAfterDelete } from '@/components/page/use-after-delete';
import { Skeleton } from '@/components/ui/skeleton';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { ApiError } from '@/lib/api/api-error';
import { describeError } from '@/lib/api/describe-error';
import { customerLinkAccess } from '@/lib/link-access';
import { canAt, requireAnyPermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import {
  HandoverDetailView,
  type HandoverTab,
} from '@/modules/handover/components/handover-detail-view';
import { findBoardSeed } from '@/modules/handover/lib/board-cache';
import { readableLocationIds } from '@/modules/handover/lib/readable-locations';
import {
  customersOfSearch,
  handoverSearchSchema,
  scopedLocationIds,
  searchFromStatus,
  statusFromSearch,
} from '@/modules/handover/lib/search';
import { useSendComment } from '@/modules/handover/lib/send-comment';
import { useCheckQueue } from '@/modules/handover/lib/use-check-queue';
import {
  handoverKeys,
  handoverQueryOptions,
  useCancelHandover,
  useRemoveHandover,
  useReopenHandover,
  useRestoreHandover,
  useSetDone,
} from '@/modules/handover/queries';
import { useActiveLocations } from '@/modules/location/active-locations-context';

export const Route = createFileRoute('/_app/handover/$handoverId/')({
  staticData: {
    locationAware: true,
    crumb: ({ params, queryClient }) => {
      const [hit] = queryClient.getQueriesData<{ number: string }>({
        queryKey: ['handovers', 'one', params.handoverId ?? ''],
      });
      return { label: hit?.[1]?.number ?? 'Detail' };
    },
  },
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
  const search = Route.useSearch();
  const listSearch = searchFromStatus(
    statusFromSearch(search),
    search.loc,
    customersOfSearch(search),
    search.deleted,
  );
  const navigate = useNavigate();
  const stack = useStackNavigation();
  const me = useMe();
  const { selectedIds } = useActiveLocations();
  // Hanya lokasi yang boleh dibaca user: satu lokasi terlarang menolak seluruh permintaan.
  const readable = readableLocationIds(me, scopedLocationIds(search.loc, selectedIds));
  const queryClient = useQueryClient();
  // Task yang hanya terlihat di papan tetap terbuka offline dari data kartu (dimuat ulang saat dibuka), tetapi hanya
  // dari kolom lokasi yang boleh dibaca.
  const readableKey = readable.join(',');
  // biome-ignore lint/correctness/useExhaustiveDependencies: `readableKey` mewakili isi `readable` (larik baru tiap render)
  const seed = useMemo(
    () => findBoardSeed(queryClient, handoverId, readable),
    [queryClient, handoverId, readableKey],
  );
  const remove = useRemoveHandover();
  // Setelah dihapus, cache detail dibuang oleh mutasi: query dimatikan agar tak dimuat ulang selagi navigasi keluar berjalan.
  const detailOptions = handoverQueryOptions(
    handoverId,
    readable,
    remove.isSuccess ? undefined : seed,
  );
  const query = useQuery({
    ...detailOptions,
    enabled: detailOptions.enabled && !remove.isSuccess,
  });
  const setDone = useSetDone();
  const sendComment = useSendComment(me.email);
  const checks = useCheckQueue(me.email);
  const cancel = useCancelHandover();
  const reopen = useReopenHandover();
  const restoreMutation = useRestoreHandover();
  const pending = setDone.isPending || cancel.isPending || reopen.isPending;
  const loadedTask = query.data;
  const canManage = loadedTask ? canAt(me, 'handover', 'manage', loadedTask.locationId) : false;
  const loadedRef = loadedTask ? { id: loadedTask.id, locationId: loadedTask.locationId } : null;

  function restore() {
    if (!loadedRef) return;
    // `mutateAsync` + toast di closure: aksi "Pulihkan" pada toast "Dihapus" dipanggil setelah navigasi, saat komponen
    // ini sudah dilepas (callback per-`mutate` tidak berjalan lagi).
    restoreMutation
      .mutateAsync(loadedRef)
      .then(() => toast.success('Task dipulihkan'))
      .catch((error: unknown) => toast.error(describeError(error)));
  }

  const afterDelete = useAfterDelete({
    indexTo: '/handover',
    canRestore: canManage,
    onRestore: restore,
  });

  // Penolakan server (task tak ada/bukan di lokasi ini/akses dicabut) otoritatif: data awal dari papan atau data
  // lama tidak boleh menutupinya. `UNAVAILABLE` tetap mempertahankan data (spanduk "data terakhir").
  // Dilatch per task+lokasi: galat UNAVAILABLE berikutnya menimpa `error` tetapi mempertahankan `data`, dan data yang
  // sudah ditolak tidak boleh muncul lagi; hanya sukses (jawaban server baru) yang melepasnya.
  const deniedScope = useRef<string | null>(null);
  const scope = `${handoverId}|${readableKey}`;
  if (
    query.error instanceof ApiError &&
    (query.error.code === 'NOT_FOUND' || query.error.code === 'FORBIDDEN')
  ) {
    deniedScope.current = scope;
  } else if (query.status === 'success') {
    deniedScope.current = null;
  }
  const denied = deniedScope.current === scope;
  const task = denied ? undefined : query.data;
  if ((query.isPending && readable.length > 0) || remove.isSuccess) {
    return (
      <PageContent>
        <Skeleton className="h-64 w-full" />
      </PageContent>
    );
  }
  if (!task) {
    const notFound = !(query.error instanceof ApiError) || denied;
    return (
      <PageContent>
        <p role="alert" className="text-sm text-destructive-text">
          {notFound
            ? 'Task tidak ditemukan di lokasi aktif.'
            : 'Gagal memuat task. Coba muat ulang.'}{' '}
          <Link to="/handover" search={listSearch} className="underline">
            Kembali ke daftar
          </Link>
        </p>
      </PageContent>
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
      owner={me.email}
      locationName={locationName}
      canOpenCustomer={customerLinkAccess(me).openCustomerHref !== undefined}
      canEdit={canAt(me, 'handover', 'edit', task.locationId)}
      canCancel={canAt(me, 'handover', 'manage', task.locationId)}
      canDelete={canAt(me, 'handover', 'manage', task.locationId)}
      canProgress={canAt(me, 'qc', 'edit', task.locationId)}
      pending={pending}
      deleting={remove.isPending}
      restoring={restoreMutation.isPending}
      tab={search.tab}
      onTabChange={(next: HandoverTab) =>
        void navigate({
          to: '/handover/$handoverId',
          params: { handoverId },
          search: { ...search, tab: next === 'catatan' ? undefined : next },
          replace: true,
        })
      }
      onEdit={() =>
        stack.push({
          to: '/handover/$handoverId/edit',
          params: { handoverId },
          search: listSearch,
        })
      }
      onDelete={() =>
        void checks
          .whenIdle(task.id)
          .then(() => remove.mutateAsync(ref))
          .then(() => afterDelete(), onError)
      }
      onRestore={restore}
      // Aksi lain menunggu antrean centang task ini kosong.
      onCancel={() =>
        void checks
          .whenIdle(task.id)
          .then(() => cancel.mutateAsync(ref))
          .then(() => toast.success('Task dibatalkan'), onError)
      }
      onMarkDone={() =>
        void checks
          .whenIdle(task.id)
          .then(() => setDone.mutateAsync(ref))
          .then(undefined, onError)
      }
      onReopen={() =>
        void checks
          .whenIdle(task.id)
          .then(() => reopen.mutateAsync(ref))
          .then(() => toast.success('Task dibuka kembali'), onError)
      }
      onCheck={(item, checked) => checks.toggle(ref, item, checked)}
      onComment={async (input) => {
        await sendComment({ ...ref, ...input });
      }}
    />
  );
}
