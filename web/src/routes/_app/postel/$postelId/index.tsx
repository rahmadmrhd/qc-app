import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { PageContent } from '@/components/page/page-container';
import { useAfterDelete } from '@/components/page/use-after-delete';
import { ConfirmDeleteDialog } from '@/components/soft-delete/confirm-delete-dialog';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { ApiError } from '@/lib/api/api-error';
import { describeError } from '@/lib/api/describe-error';
import { itemLinkAccess } from '@/lib/link-access';
import { can, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { POSTEL_VIEW_TABS, PostelView } from '@/modules/postel/components/postel-view';
import { postelDeleteUsage } from '@/modules/postel/lib/delete-usage';
import {
  postelQueryOptions,
  postelViewQueryOptions,
  useRemovePostels,
  useRestorePostels,
} from '@/modules/postel/queries';

const searchSchema = z.object({
  tab: z.enum(POSTEL_VIEW_TABS).optional().catch(undefined),
});

export const Route = createFileRoute('/_app/postel/$postelId/')({
  staticData: {
    crumb: ({ params, queryClient }) => ({
      label:
        queryClient.getQueryData(postelQueryOptions(params.postelId ?? '').queryKey)?.name ??
        'Detail',
    }),
  },
  validateSearch: (search: Record<string, unknown>) => searchSchema.parse(search),
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'sticker', 'view'),
  // Catatan yang tak ada/terhapus (bagi yang tak berhak) ditangani halaman sebagai "tidak ditemukan".
  loader: ({ context, params }) =>
    context.queryClient
      .ensureQueryData(postelViewQueryOptions(params.postelId))
      .catch(() => undefined),
  component: PostelDetailRoute,
});

/** Galat "catatan tidak ada" (id salah, atau terhapus bagi yang tak boleh melihatnya). */
function isMissing(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN');
}

function PostelDetailRoute() {
  const { postelId } = Route.useParams();
  const { tab } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const stack = useStackNavigation();
  const me = useMe();
  const query = useQuery(postelViewQueryOptions(postelId));
  const postel = query.data;
  const removePostels = useRemovePostels();
  const restorePostels = useRestorePostels();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const canEdit = can(me, 'sticker', 'edit');

  function restore() {
    // `mutateAsync` + toast di closure: aksi "Pulihkan" pada toast "Dihapus" dipanggil setelah navigasi, saat
    // komponen ini sudah dilepas (callback per-`mutate` tidak berjalan lagi).
    restorePostels
      .mutateAsync({ ids: [postelId] })
      .then(() => toast.success('Catatan Postel dipulihkan'))
      .catch((error: unknown) => toast.error(describeError(error)));
  }

  const afterDelete = useAfterDelete({
    indexTo: '/postel',
    canRestore: canEdit,
    onRestore: restore,
  });

  if (query.isError && !isMissing(query.error)) throw query.error;
  if (query.isPending) {
    return (
      <PageContent>
        <p className="text-sm text-muted-foreground">Memuat…</p>
      </PageContent>
    );
  }

  function remove() {
    removePostels.mutate(
      { ids: [postelId] },
      {
        onSuccess: () => {
          setConfirmDelete(false);
          afterDelete();
        },
        onError: (error) => {
          setConfirmDelete(false);
          toast.error(describeError(error));
        },
      },
    );
  }

  return (
    <>
      <PostelView
        postel={postel}
        canEdit={canEdit}
        restorePending={restorePostels.isPending}
        canOpenItem={itemLinkAccess(me).openItemHref !== undefined}
        canOpenDeletedItem={itemLinkAccess(me).canOpenDeleted}
        tab={tab}
        onTabChange={(next) =>
          void navigate({ search: (prev) => ({ ...prev, tab: next }), replace: true })
        }
        onBack={() => stack.pop({ to: '/postel' })}
        onEdit={() => stack.push({ to: '/postel/$postelId/edit', params: { postelId } })}
        onDelete={() => setConfirmDelete(true)}
        onRestore={restore}
      />
      {postel ? (
        <ConfirmDeleteDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          count={1}
          subject="catatan Postel"
          {...(postel.itemCount > 0 ? { usage: postelDeleteUsage(postel.itemCount) } : {})}
          onConfirm={remove}
          busy={removePostels.isPending}
        />
      ) : null}
    </>
  );
}
