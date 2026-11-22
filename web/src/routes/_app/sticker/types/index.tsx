import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { describeError } from '@/lib/api/describe-error';
import { can, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import {
  type StickerTypeMutations,
  type StickerTypesFilter,
  StickerTypesPage,
} from '@/modules/sticker/components/sticker-types-page';
import { useStickerTypeSave } from '@/modules/sticker/lib/use-sticker-save';
import {
  stickerTypesQuery,
  useRemoveStickerTypes,
  useRestoreStickerTypes,
  useSetStickerTypeStatus,
  useSetStickerTypeStatusBatch,
} from '@/modules/sticker/queries';

const searchSchema = z.object({
  q: z.string().max(100).optional().catch(undefined),
  status: z.enum(['all', 'active', 'inactive', 'deleted']).optional().catch(undefined),
});

export const Route = createFileRoute('/_app/sticker/types/')({
  validateSearch: (search: Record<string, unknown>) => searchSchema.parse(search),
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'sticker', 'view'),
  loader: ({ context, location }) => {
    const search = searchSchema.parse(location.search);
    // Tampilan Terhapus hanya untuk `sticker: manage`: tak dimuat di loader (server akan menolaknya).
    if (search.status === 'deleted') return undefined;
    return context.queryClient.ensureQueryData(stickerTypesQuery());
  },
  component: StickerTypesRoute,
});

function StickerTypesRoute() {
  const me = useMe();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const canManage = can(me, 'sticker', 'manage');
  // `?status=deleted` tulisan tangan oleh pengguna tanpa hak diperlakukan sebagai "Semua status".
  const status = search.status === 'deleted' && !canManage ? 'all' : (search.status ?? 'all');
  const list = useQuery(stickerTypesQuery(status === 'deleted' ? 'deleted' : undefined));
  const handleSave = useStickerTypeSave();
  const setStatus = useSetStickerTypeStatus();
  const statusBatch = useSetStickerTypeStatusBatch();
  const removeTypes = useRemoveStickerTypes();
  const restoreTypes = useRestoreStickerTypes();

  const filter: StickerTypesFilter = { q: search.q ?? '', status };

  function changeFilter(patch: Partial<StickerTypesFilter>) {
    // Filter/cari mengganti entri riwayat (replace), bukan menumpuknya.
    void navigate({
      search: (prev) => ({
        ...prev,
        ...(patch.q !== undefined ? { q: patch.q || undefined } : {}),
        ...(patch.status !== undefined
          ? { status: patch.status === 'all' ? undefined : patch.status }
          : {}),
      }),
      replace: true,
    });
  }

  const mutations: StickerTypeMutations = {
    setStatus: (ids, next) => statusBatch.mutateAsync({ ids, status: next }).then((r) => r.items),
    remove: (ids) => removeTypes.mutateAsync({ ids }).then((r) => r.ids),
    restore: (ids) => restoreTypes.mutateAsync({ ids }).then((r) => r.items),
    reload: () => void list.refetch(),
  };

  return (
    <StickerTypesPage
      types={list.data ?? []}
      canEdit={can(me, 'sticker', 'edit')}
      canManage={canManage}
      filter={filter}
      onFilterChange={changeFilter}
      pendingStatusId={setStatus.isPending ? (setStatus.variables?.id ?? null) : null}
      onSave={handleSave}
      onToggleStatus={(type) => {
        const next = type.status === 'active' ? 'inactive' : 'active';
        setStatus.mutate(
          { id: type.id, status: next },
          {
            onSuccess: () =>
              toast.success(next === 'active' ? 'Jenis diaktifkan' : 'Jenis dinonaktifkan'),
            onError: (error) => toast.error(describeError(error)),
          },
        );
      }}
      mutations={mutations}
      isLoading={list.isPending}
      isError={list.isLoadingError}
      onRetry={() => void list.refetch()}
    />
  );
}
